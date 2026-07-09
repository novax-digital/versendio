# ADR-0002: Datenmodell & RLS-Strategie

**Status:** akzeptiert (Checkpoint-Freigabe ausstehend) · **Datum:** 2026-07-09

## Kontext
Masterprompt §5 gibt die Tabellenliste als Richtschnur vor. Zu klären: Rollen-/Statusschutz gegen Selbst-Eskalation, Sichtbarkeit der EK-Preise, Snapshot-Strategie, Queue-Modellierung.

## Entscheidung — Tabellen (vollständiges ER-Diagramm in `docs/ARCHITECTURE.md`)

**Identität & Konto**
- `profiles` — PK = `auth.users.id` (**bewusst ohne FK auf `auth.users`**: die Zeile überlebt die Account-Löschung anonymisiert, ADR-0009); display_name, company, Rechnungsadresse (street, zip, city, country), `role user|admin`, `status active|blocked|deleted`, `deleted_at`, `plan_id → plans`, `credit_balance_cents int NOT NULL DEFAULT 0 CHECK (>= 0)`, `cost_center text UK` (stabiler Kurzcode `ep-…` für DP-Rechnungszuordnung, ADR-0008; Längenlimit der API wird in Phase 5 verifiziert), Zeitstempel. **Geschützte Spalten** (`role`, `status`, `plan_id`, `credit_balance_cents`, `cost_center`): BEFORE-UPDATE-Trigger verwirft Änderungen, wenn der Aufrufer nicht service-role ist — User-RLS-Update-Policy bleibt dadurch simpel.
- `sender_addresses` — user_id, Label, Firma/Name, Straße, PLZ, Ort, Land, `sender_line` (einzeilige Absenderzeile, generiert + editierbar), `is_default` (partieller Unique-Index je User).
- `billing_accounts` — user_id PK, `stripe_customer_id` unique, Auto-Aufladung: enabled, threshold_cents, amount_cents, default_payment_method_id, `auto_topup_pending_at timestamptz` (In-flight-Guard: solange gesetzt, wird kein weiterer Auto-Topup-PaymentIntent erzeugt; Webhook success/failed löscht ihn — verhindert Mehrfach-Abbuchung bei wiederholtem Schwellwert-Trigger).

**E-Post**
- `epost_accounts` — für das Partner-Modell (je Kunde) reserviert; beim Eigenversender-Modell (ADR-0008) kommt der zentrale Account aus ENV. Spalten: user_id (nullable), ekp, mobile_masked, `password_enc`, `secret_enc` (AES-256-GCM, ADR-0005), status, activated_at. Keine Client-Policies.
- `epost_tokens` — gecachte Provider-JWTs: `account_ref` **unique** (sauberes Upsert beim Refresh, keine Stale-Token-Akkumulation), `token_enc`, expires_at (Serverless: DB statt Modul-Cache). Keine Client-Policies.

**Briefe**
- `letters` — user_id, title, `source upload|editor`, storage_path (Upload bzw. gerenderte Vorschau), page_count, sheet_count, file_size_bytes, `validation jsonb` (A4, PDF/A-Hinweis, dpi, Zonen-Checks), `address_zone_result ok|warning|fail`, `needs_cover_letter bool`, `editor_document jsonb` (Blockstruktur, nur Editor), `has_placeholders bool`, `status draft|ready`, Zeitstempel.
- `letter_templates` — user_id, name, `editor_document jsonb`, logo_storage_path.

**Empfänger**
- `contacts` — user_id, salutation, first_name, last_name, company, street, address_extra, zip, city, `country char(2)` (ISO-3166-1, Default DE), email, `custom jsonb`, `dedup_key text` (normalisiert, generiert; Index für Duplikaterkennung — kein Unique-Constraint, Duplikate sind Warnung, kein Verbot).
- `lead_lists` — user_id, name, description, `source manual|import`.
- `lead_list_entries` — list_id (CASCADE), contact_id (CASCADE), unique(list_id, contact_id).

**Versand**
- `send_jobs` — user_id, letter_id, sender_address-**Snapshot** (jsonb), Optionen: `is_color`, `is_duplex`, `registered none|einwurf|einschreiben|rueckschein`, `is_test` (Probeversand), `scheduled_release_at` (Stornofrist via UploadManagement, nullable), `client_token uuid` + **unique(user_id, client_token)** (Wizard-Idempotenz: Doppelklick/Retry liefert den bestehenden Job statt Doppelbuchung, ADR-0003 §4), `status draft|queued|processing|completed|completed_with_errors|canceled`, total_items, total_vk_cents, total_ek_cents, `batch_id uuid`, completed_at.
- `send_job_items` — job_id (CASCADE), user_id (denormalisiert für RLS), contact_id (SET NULL), **Empfänger-Snapshot** (alle Adressfelder + gerenderte address_lines), rendered_pdf_path, sheet_count, `vk_cents`, `ek_cents`, `pricing_snapshot jsonb` (Stufen-Aufschlüsselung), provider (`mock|epost`), provider_letter_id, `status pending|on_hold_funds|submitting|submitted|accepted|checked|print_center|sent|failed|canceled` (`on_hold_funds`: Nachbelastung bei Mehr-Blättern nicht gedeckt — ADR-0006 §4), provider_status_id smallint, error_code, error_message, attempts, `first_submit_attempt_at` (für das 60-min-Duplicate-Failsafe-Fenster, ADR-0004 §5), frankier_id, refunded_at, submitted_at, last_status_sync_at.
- `status_events` — item_id (CASCADE), `event_type status_change|bze_tracking|system_note` (BZE-Ereignisse „im Zielgebiet angekommen“ laufen als eigener Event-Typ in derselben Zeitleiste), status, provider_status_id, details, source `provider|system`, occurred_at.

**Abrechnung**
- `plans` — name, description, `discount_percent numeric(5,2) DEFAULT 0`, is_default. Rabatt wirkt auf VK bei Preisberechnung; Snapshot friert das Ergebnis ein.
- `pricing_table` — `option_key` unique (z. B. `tier_standard_bw_simplex`, `extra_sheet_color_duplex`, `surcharge_registered_einwurf`), display_name_de, `kind tier|extra_sheet|surcharge`, `zone national|international`, `ek_cents int NULL` (NULL = EK-TODO), `vk_cents int NOT NULL`, active, sort_order. Seed aus `docs/reference/epost/preisliste-api-2025.md`.
- `credit_transactions` — user_id, `type topup|spend|refund|admin_adjust`, `amount_cents` (signiert), `balance_after_cents`, reference_type/reference_id (**festes disjunktes Vokabular**, ADR-0003 §3), `receipt_url` + `stripe_invoice_id` (nullable, Belegdownload bei Topups), comment, created_by. **Append-only** (ADR-0003).

**Betrieb**
- `job_queue` — `type submit_item|sync_status|send_email|cleanup_storage|auto_topup|release_queued`, payload jsonb, `status pending|running|done|failed|dead`, run_at, attempts, max_attempts, locked_at, locked_by, last_error (ADR-0004).
- `webhook_events` — provider, `event_id` unique, type, payload, status, processed_at, error.
- `audit_log` — actor_user_id, action, target_type, target_id, details jsonb (PII-frei), append-only.
- `app_settings` — key PK, value jsonb, updated_by (Aufladebeträge, Mindestbetrag, Low-Credit-Schwelle, Polling-Intervalle, Feature-Flags).
- `rate_limits` — Postgres-basiertes Rate Limiting (Serverless-tauglich, kein Fremd-Service): `key text` (z. B. `login:{ip}`, `upload:{user_id}`, `send:{user_id}`), `window_start timestamptz`, `count int`, PK (key, window_start). Fixed-Window-Zählung über eine Upsert-Funktion `check_rate_limit(key, limit, window_seconds)`; Bereinigung im Maintenance-Cron. Optionaler Upstash-Adapter später hinter ENV-Flag. Keine Client-Policies.

## Indizes (Hot Paths)

- `job_queue (status, run_at)` — `claim_jobs`-Scan; partieller Index `WHERE status = 'pending'`.
- `send_job_items (status, last_status_sync_at)` — Auswahl für Status-Polling (Status 1–3).
- `send_job_items (job_id)`, `send_job_items (user_id, created_at)` — Job-Detail & Nutzerlisten.
- `status_events (item_id, occurred_at)` — Zeitleiste.
- `credit_transactions (user_id, created_at DESC)` — Transaktionsübersicht.
- `send_jobs (user_id, created_at DESC)`, `send_jobs (status)` — Listen & Admin-Monitor.
- `contacts (user_id, dedup_key)` — Duplikaterkennung; `contacts (user_id)` trgm-Index auf Namen/Firma für die Suche (pg_trgm).
- `lead_list_entries (list_id)`, `letters (user_id, created_at DESC)`.
- **RLS-Performance:** in Policies `auth.uid()`/`is_admin()` in Skalar-Subselects kapseln (`(SELECT auth.uid())`), damit sie je Query statt je Zeile ausgewertet werden.

## RLS-Strategie
1. **RLS auf allen Tabellen aktiviert**, ausnahmslos.
2. **Own-row-Policies** (`user_id = auth.uid()`) für: profiles (select/update eigener Zeile), sender_addresses, billing_accounts (select), letters, letter_templates, contacts, lead_lists, lead_list_entries (via Liste), send_jobs, send_job_items, status_events (select via Item), credit_transactions (**nur SELECT** — Schreiben ausschließlich Server).
3. **Admin-Zugriff** über SECURITY-DEFINER-Funktion `public.is_admin()` (liest `profiles.role`); Admin-Policies zusätzlich zu Own-row. Alle Admin-Routen tragen **zusätzlich** serverseitige Guards (Defense in depth).
4. **Keine Client-Policies** (nur service-role): `epost_accounts`, `epost_tokens`, `job_queue`, `webhook_events`, `app_settings`, `pricing_table`, `audit_log` (Admin liest via Server-Guard). **Begründung `pricing_table`:** EK-Preise/Marge sind Geschäftsgeheimnis; RLS kann Spalten nicht verbergen → Kostenvorschau liefert der Server (nur VK).
5. **Storage:** private Buckets `letters` (Uploads, gerenderte PDFs: `{user_id}/…`), `assets` (Logos), `imports` (CSV/XLSX, kurzlebig). Pfad-Policies auf `auth.uid()`-Prefix; Auslieferung über kurzlebige signierte URLs.
6. Enums als Postgres-Enum-Typen (Konsistenz; Legacy hatte Text/Enum-Drift, LEGACY_FINDINGS §3).

## Verworfene Alternativen
- `user_roles`-Extratabelle (Legacy): eine Rolle je User reicht; Schutz per Trigger ist einfacher und schließt Status/Plan/Balance gleich mit ein.
- Empfänger nur als FK ohne Snapshot: Preis-/Adressänderungen dürfen historische Sendungen nicht verändern (Nachweisbarkeit, Storno, Reklamation).
- Saldo ausschließlich als `SUM(ledger)`: O(n) je Anzeige und Sperren schwierig → denormalisierter Saldo mit CHECK + Trigger-Schutz + Ledger als Wahrheit (Abgleichs-Job in QA).
