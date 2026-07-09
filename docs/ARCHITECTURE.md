# ARCHITECTURE — E-Post-Mailer

> Systemarchitektur. Grundsatzentscheidungen als ADRs in `docs/adr/` (dort jeweils Begründung + Alternativen).
> **Stand: final (Phase 10).** Betriebsmodell entschieden: Eigenversender (ADR-0008).

## 1. Systemüberblick

```mermaid
flowchart LR
    subgraph Client["Browser"]
        UI["Next.js UI<br/>(React 19, shadcn/ui)"]
    end
    subgraph Vercel["Vercel (Serverless, Node)"]
        SA["Server Actions<br/>(Zod-validiert)"]
        RH["Route Handlers<br/>/api/webhooks/stripe"]
        CRON["Cron-Worker<br/>/api/cron/* (CRON_SECRET)"]
    end
    subgraph Supabase
        AUTH["Auth"]
        PG[("Postgres<br/>RLS auf allen Tabellen<br/>job_queue, Ledger")]
        ST[("Storage<br/>private Buckets")]
    end
    subgraph Extern
        EPOST["E-POSTBUSINESS API<br/>(DocuGuide) — kein Webhook"]
        STRIPE["Stripe (Testmodus,<br/>FEATURE_STRIPE)"]
        RESEND["Resend / SMTP"]
    end
    UI --> SA
    UI -->|Session| AUTH
    SA --> PG
    SA --> ST
    STRIPE -->|Webhooks| RH --> PG
    CRON --> PG
    CRON -->|LetterProvider| EPOST
    CRON -->|Polling Status| EPOST
    CRON --> RESEND
    CRON --> ST
```

- **Alle Mutationen serverseitig** (Server Actions / Route Handlers) mit Zod; der Browser spricht Supabase nur für Auth-Session und lesende, RLS-geschützte Queries an.
- **Hintergrundarbeit** ausschließlich über die DB-Queue + Vercel Cron (ADR-0004). E-Post liefert keine Webhooks → gedrosseltes Status-Polling.
- **Versand-Provider** hinter `LetterProvider`-Interface; `MockProvider` bei `MOCK_MODE=true` oder fehlender Konfiguration (ADR-0005).

## 2. ER-Diagramm

```mermaid
erDiagram
    auth_users ||--|| profiles : "id"
    profiles }o--|| plans : "plan_id"
    profiles ||--o{ sender_addresses : ""
    profiles ||--o| billing_accounts : ""
    profiles ||--o{ credit_transactions : ""
    profiles ||--o{ letters : ""
    profiles ||--o{ letter_templates : ""
    profiles ||--o{ contacts : ""
    profiles ||--o{ lead_lists : ""
    profiles ||--o{ send_jobs : ""
    profiles ||--o{ epost_accounts : "(Partner-Modell, optional)"
    lead_lists ||--o{ lead_list_entries : ""
    contacts ||--o{ lead_list_entries : ""
    letters ||--o{ send_jobs : ""
    letter_templates ||--o{ letters : "(optional)"
    send_jobs ||--o{ send_job_items : ""
    contacts |o--o{ send_job_items : "contact_id (SET NULL)"
    send_job_items ||--o{ status_events : ""

    profiles {
        uuid id PK "= auth.users.id, KEIN FK (ADR-0009)"
        text display_name
        text company
        text billing_street
        text billing_zip
        text billing_city
        char billing_country
        enum role "user|admin (Trigger-geschützt)"
        enum status "active|blocked|deleted (Trigger-geschützt)"
        timestamptz deleted_at
        uuid plan_id FK "(Trigger-geschützt)"
        int credit_balance_cents "CHECK >= 0 (Trigger-geschützt)"
        text cost_center UK "DP-Rechnungszuordnung (Trigger-geschützt)"
    }
    plans {
        uuid id PK
        text name
        numeric discount_percent
        bool is_default
    }
    sender_addresses {
        uuid id PK
        uuid user_id FK
        text label
        text company
        text street
        text zip
        text city
        char country
        text sender_line "einzeilige Absenderzeile"
        bool is_default "partieller Unique-Index je User"
    }
    billing_accounts {
        uuid user_id PK
        text stripe_customer_id UK
        bool auto_topup_enabled
        int auto_topup_threshold_cents
        int auto_topup_amount_cents
        text default_payment_method_id
        timestamptz auto_topup_pending_at "In-flight-Guard"
    }
    credit_transactions {
        uuid id PK
        uuid user_id FK
        enum type "topup|spend|refund|admin_adjust"
        int amount_cents "signiert"
        int balance_after_cents
        text reference_type "disjunktes Vokabular: job_confirm|item_render_adjust|item_failed|item_canceled|job_cancel_rest|stripe_event (ADR-0003)"
        text reference_id "Unique je (type,ref_type,ref) — Idempotenz"
        text receipt_url "Belegdownload (Topup)"
        text stripe_invoice_id
        text comment
        text created_by
    }
    letters {
        uuid id PK
        uuid user_id FK
        text title
        enum source "upload|editor"
        text storage_path
        int page_count
        int sheet_count
        int file_size_bytes
        jsonb validation "Ergebnis je Prüfregel"
        enum address_zone_result "ok|warning|fail"
        bool needs_cover_letter "Systemempfehlung"
        bool use_cover_letter "Nutzerwahl"
        jsonb editor_document "Blockmodell, versioniert"
        bool has_placeholders
        enum status "draft|ready"
    }
    letter_templates {
        uuid id PK
        uuid user_id FK
        text name
        jsonb editor_document
        text logo_storage_path
    }
    contacts {
        uuid id PK
        uuid user_id FK
        text salutation
        text first_name
        text last_name
        text company
        text street
        text address_extra
        text zip
        text city
        char country "ISO-3166-1, Default DE"
        text email
        jsonb custom
        text dedup_key "generiert, Index"
    }
    lead_lists {
        uuid id PK
        uuid user_id FK
        text name
        enum source "manual|import"
    }
    lead_list_entries {
        uuid id PK
        uuid list_id FK "CASCADE"
        uuid contact_id FK "CASCADE, unique(list,contact)"
    }
    send_jobs {
        uuid id PK
        uuid user_id FK
        uuid letter_id FK
        jsonb sender_snapshot
        bool is_color
        bool is_duplex
        enum registered "none|einwurf|einschreiben|rueckschein"
        bool is_test "Probeversand"
        timestamptz scheduled_release_at "Stornofrist, nullable"
        uuid client_token "unique(user_id, client_token) — Wizard-Idempotenz"
        enum status "draft|queued|processing|completed|completed_with_errors|canceled"
        int total_items
        int total_vk_cents
        int total_ek_cents
        uuid batch_id
        int provider_batch_id "int32 fuer API-Sammelabfragen"
    }
    send_job_items {
        uuid id PK
        uuid job_id FK "CASCADE"
        uuid user_id FK "denorm. für RLS"
        uuid contact_id FK "SET NULL"
        jsonb recipient_snapshot "Adressfelder + address_lines"
        text rendered_pdf_path
        int sheet_count
        int vk_cents "Snapshot"
        int ek_cents "Snapshot"
        jsonb pricing_snapshot
        enum provider "mock|epost"
        text provider_letter_id
        enum status "pending|on_hold_funds|submitting|submitted|accepted|checked|print_center|sent|failed|canceled"
        smallint provider_status_id "1|2|3|4|99"
        text error_code
        text error_message
        int attempts
        timestamptz first_submit_attempt_at "60-min-Failsafe-Fenster"
        text frankier_id
        timestamptz refunded_at
        timestamptz retried_at "Admin-Retry: exakt einmal"
        uuid retry_of_item_id FK "Klon-Herkunft"
        timestamptz submitted_at
        timestamptz last_status_sync_at
    }
    status_events {
        uuid id PK
        uuid item_id FK "CASCADE"
        enum event_type "status_change|bze_tracking|system_note"
        enum status
        smallint provider_status_id
        text details
        enum source "provider|system"
        timestamptz occurred_at
    }
    pricing_table {
        uuid id PK
        text option_key UK "tier_*|extra_sheet_*|surcharge_*"
        text display_name_de
        enum kind "tier|extra_sheet|surcharge"
        enum zone "national|international"
        int ek_cents "NULL = TODO"
        int vk_cents
        bool active
        int sort_order
    }
    epost_accounts {
        uuid id PK
        uuid user_id FK "nullable"
        text ekp
        text mobile_masked
        text password_enc "AES-256-GCM"
        text secret_enc "AES-256-GCM"
        enum status "pending_activation|active|error"
    }
    epost_tokens {
        uuid id PK
        text account_ref UK
        text token_enc
        timestamptz expires_at
    }
    rate_limits {
        text key PK "login:{ip}, upload:{user}, send:{user}"
        timestamptz window_start PK
        int count
    }
    job_queue {
        uuid id PK
        enum type "submit_item|sync_status|send_email|cleanup_storage|auto_topup|release_queued"
        jsonb payload
        enum status "pending|running|done|failed|dead"
        timestamptz run_at
        int attempts
        int max_attempts
        timestamptz locked_at
        text locked_by
        text last_error
    }
    webhook_events {
        uuid id PK
        text provider
        text event_id UK
        text type
        jsonb payload
        enum status "received|processed|failed|skipped"
    }
    audit_log {
        uuid id PK
        uuid actor_user_id
        text action
        text target_type
        text target_id
        jsonb details "PII-frei"
    }
    app_settings {
        text key PK
        jsonb value
        uuid updated_by
    }
```

(`pricing_table`, `job_queue`, `webhook_events`, `audit_log`, `app_settings`, `epost_*` sind bewusst beziehungsarm — Zugriff nur service-role, siehe ADR-0002 §4.)

## 3. Versand-Pipeline (Happy Path + Fehlerfall)

```mermaid
sequenceDiagram
    participant U as Nutzer
    participant SA as Server Action
    participant DB as Postgres
    participant W as Cron-Worker
    participant P as LetterProvider

    U->>SA: Versand bestätigen (Wizard, client_token)
    Note over SA,DB: client_token unique je User —<br/>Doppelklick/Retry liefert bestehenden Job
    SA->>DB: TRANSAKTION: book_credit(spend, job_confirm, Jobsumme)<br/>+ send_job + items (Preis-Snapshots)<br/>+ submit_item-Queue-Jobs
    Note over SA,DB: insufficient_funds → Abbruch,<br/>nichts angelegt
    SA-->>U: Job angelegt (queued)

    loop jede Minute (Batch ≤ 10, Zeitbudget)
        W->>DB: claim_jobs(FOR UPDATE SKIP LOCKED)
        W->>W: PDF personalisieren + validieren
        alt Blattzahl weicht von Schätzung ab
            W->>DB: book_credit(item_render_adjust) — Refund bei weniger,<br/>Nachbelastung bei mehr Blättern
            Note over W,DB: Nachbelastung nicht gedeckt →<br/>Item on_hold_funds, KEIN Versand,<br/>Mail an Nutzer; Wiederaufnahme nach Aufladung
        end
        W->>P: submitLetter(item, DuplicateFailsafe, custom1=item.id)
        P-->>W: letterID
        W->>DB: item → submitted, status_event
        Note over W,P: Crash nach POST: Recovery nur via<br/>Provider-Lookup (custom1/batch),<br/>nie blinder Resubmit (ADR-0004 §5)
    end

    loop alle 15 min (gedrosselt)
        W->>P: Status offener Sendungen (1–3)
        P-->>W: statusID 1|2|3|4|99
        W->>DB: Status + Zeitleiste aktualisieren
        alt statusID 99 (final)
            W->>DB: book_credit(refund, item_failed, tatsächlich belasteter VK)
            Note over W,DB: eigener reference_type — kollidiert nie<br/>mit item_render_adjust desselben Items
            W->>DB: send_email-Job (Fehlerbenachrichtigung)
        end
    end
```

- **Probeversand:** identischer Pfad mit `is_test=true` — keine Spend-Buchung, `testFlag` beim Provider, Ergebnis-PDF (`TestResult`, 48 h) im Wizard abrufbar.
- **Stornofrist:** `scheduled_release_at` gesetzt → Einlieferung in den Sammelkorb (UploadManagement); `release_queued`-Job zum Zeitpunkt X; bis dahin Stornieren (cancelQueued + Refund) oder Vorziehen möglich.
- **Retry:** transienter Fehler → Backoff (ADR-0004); endgültig → `failed` + Refund; E324-Duplikat → als bereits eingeliefert behandeln, Status nachziehen.

## 4. Storage-Layout (alle Buckets privat, signierte URLs)

| Bucket | Pfad | Inhalt | Lebensdauer |
|---|---|---|---|
| `letters` | `{user_id}/letters/{letter_id}.pdf` | Upload-Original / Editor-Vorschau | bis Löschung durch Nutzer |
| `letters` | `{user_id}/jobs/{job_id}/{item_id}.pdf` | personalisierte Versand-PDFs | `LETTER_RETENTION_DAYS` nach Zustellung (Cron) |
| `assets` | `{user_id}/logos/{uuid}.{ext}` | Briefkopf-Logos | bis Löschung |
| `imports` | `{user_id}/{uuid}.csv/.xlsx` | Import-Rohdateien | 24 h (Cron) |

## 5. Sicherheits-Grundsätze (Details ADR-0002, -0003, -0005)

- RLS überall; Admin doppelt abgesichert (RLS + Server-Guard); geschützte Profilspalten per Trigger.
- Geld nur über `book_credit` (SECURITY DEFINER, service-role); Ledger append-only; Idempotenz über disjunktes `reference_type`-Vokabular (ADR-0003 §3); Wizard-Bestätigung idempotent via `client_token`.
- EK-Preise/Marge nie im Client; Kostenvorschau liefert ausschließlich VK.
- E-Post-Credentials + Tokens AES-256-GCM-verschlüsselt; Adress-/Briefdaten nie im Klartext in Logs.
- Worker-Endpoints nur mit `CRON_SECRET`; Stripe nur mit Signaturprüfung + `webhook_events`-Idempotenz.
- **Rate Limiting** Postgres-basiert (`rate_limits`-Tabelle, Fixed Window) auf Auth-, Upload- und Versand-Endpunkten — Serverless-tauglich ohne Fremd-Service (ADR-0002).
- **DSGVO-Lebenszyklus** (Löschung/Anonymisierung/Retention) vollständig definiert in ADR-0009 inkl. FK-`ON DELETE`-Matrix.

## 6. Datenbank-Funktionen (alle SECURITY DEFINER, `search_path` gepinnt, nur `service_role`)

| Funktion | Zweck |
|---|---|
| `book_credit` | **Einziger Geld-Eintrittspunkt.** Row-Lock je Nutzer, kein Negativsaldo, append-only Ledger |
| `confirm_send_job` | Job + Belastung + Items + Queue-Jobs in **einer** Transaktion; `client_token`-Idempotenz |
| `cancel_pending_job_items` | Storno noch nicht eingelieferter Items inkl. Erstattung |
| `admin_retry_item` | Retry: Claim (exakt einmal) + Klon + Belastung + Queue, atomar |
| `anonymize_account` | DSGVO-Löschung: Erstattung, PII-Hard-Delete, Snapshot-Scrub, Profil-Anonymisierung |
| `claim_jobs` / `reset_stuck_jobs` | Queue-Claim mit `FOR UPDATE SKIP LOCKED`; Lock-Recovery |
| `check_rate_limit` | Fixed-Window-Drosselung (Postgres statt Fremd-Service) |
| `check_ledger_integrity` | Abgleich `SUM(ledger)` vs. denormalisierter Saldo |
| `admin_dashboard_stats` | KPI-Aggregation in SQL |
| `set_default_sender_address` / `upsert_sender_address` | „genau eine Standardadresse" atomar |
| `is_admin` / `is_service_request` | RLS- und Trigger-Helfer |

## 7. Spaltenschutz für Einkaufspreise

`ek_cents`, `total_ek_cents` und `pricing_snapshot` sind **nicht** durch RLS zu schützen (RLS filtert
Zeilen, keine Spalten). Migration `…0003_ek_column_privacy.sql` entzieht der Rolle `authenticated`
daher das Tabellen-`SELECT` und erteilt eine **explizite Spaltenliste ohne die EK-Felder**. Neue
Spalten sind dadurch standardmäßig gesperrt und müssen bewusst freigegeben werden (siehe
`retried_at`/`retry_of_item_id` in `…0004`).

## 8. Erledigte Verifikationsgates

- ✅ Swagger v2.6.1 geladen; Sammel-Statusabfrage (`Letter/Open`), Crash-Lookup (`Letter/Custom1`),
  `CancelQueued`/`ReleaseQueued`, `Letter/Registered`, `costCenter`-Limit (8 Zeichen) bestätigt.
- ✅ `addressLine1–5` tragen **keine** PLZ/Ort/Land (ASSUMPTIONS A-010).
- ✅ CSP-Nonce gegen den Produktions-Build per HTTP verifiziert.
- ⬜ Offen bis zur ersten Live-Umgebung: DB-abhängige QA-Punkte (`docs/QA_CHECKLIST.md`) und der
  E-Post-Live-Testplan (`docs/EPOST_INTEGRATION.md` §4).
- International (Zonen/Preise) strukturell vorbereitet, initial deaktiviert.
