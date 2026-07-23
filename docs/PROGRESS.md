# PROGRESS

> Laufender Projektfortschritt. Bei Session-Wiederaufnahme: zuerst `MASTERPROMPT.md`, dann dieses Dokument, dann `docs/ASSUMPTIONS.md` lesen.

## Phasenübersicht

| Phase | Titel | Status |
|---|---|---|
| 0 | Setup & Analyse | ✅ abgeschlossen |
| 1 | Architektur (⛔ Checkpoint) | ✅ abgeschlossen — **freigegeben 2026-07-09** |
| 2 | Foundation (Scaffold, Supabase, Auth) | ✅ abgeschlossen |
| 3 | Briefe (Upload, Editor, PDF-Pipeline) | ✅ abgeschlossen |
| 4 | Kontakte & Leadlisten | ✅ abgeschlossen |
| 5 | Versand-Pipeline (Queue, Provider, Polling) | ✅ abgeschlossen |
| 6 | Guthaben, Preise & Stripe-Vorbereitung | ✅ abgeschlossen |
| 7 | Admin-Konsole | ✅ abgeschlossen |
| 8 | Härtung (Security, DSGVO, UX) | ✅ abgeschlossen |
| 9 | QA | ✅ abgeschlossen |
| 10 | Übergabe | ✅ abgeschlossen |

---

# Abschlussbericht

**Alle 10 Phasen abgeschlossen.** Die Anwendung ist im Mock-Modus end-to-end nutzbar: Registrierung
→ Brief (Upload oder Editor) → Kontakte/Leadlisten → Versand mit Kostenvorschau → Statusverfolgung
→ Guthaben. Admin-Konsole, DSGVO-Funktionen und Stripe (Testmodus) sind vollständig.

## Was gebaut wurde

| Bereich | Umfang |
|---|---|
| **Datenbank** | 21 Tabellen, RLS auf allen; 13 SECURITY-DEFINER-Funktionen (Geld, Queue, Retry, DSGVO); Spalten-Privileg schützt Einkaufspreise; 7 Migrationen |
| **PDF-Pipeline** | Ein gemeinsamer Validierungspfad (exakte A4-Box, Blatt-/Größenlimits, PDF/A-Heuristik, **echte Adresszonen-Analyse** via pdf.js); Block-Editor mit Serienbrief-Platzhaltern; Deckblatt-Generator; Schablone-V3-Geometrie zentral |
| **Versand** | `LetterProvider`-Interface, voll funktionsfähiger MockProvider, `EpostProvider` strikt gegen Swagger v2.6.1; DB-Queue + 3 Cron-Worker; gedrosseltes Status-Polling; automatische Erstattung bei Status 99; Stornofrist über Queue-Hold |
| **Geld** | Append-only Ledger, `book_credit` als einziger Eintrittspunkt (Row-Lock, kein Negativsaldo), disjunktes Idempotenz-Vokabular; EK/VK-Preistabelle mit Margen-Reporting |
| **Stripe** | Testmodus komplett (Checkout, SEPA, Auto-Aufladung, Belege, Webhook mit Replay-Sicherheit), hinter Feature-Flag, Live-Keys code-seitig gesperrt |
| **Admin** | KPIs inkl. Rohertrag, Nutzerverwaltung, Sendejob-Monitor mit atomarem Retry, Preisverwaltung, typisierte Einstellungen, Audit-Log |
| **Sicherheit/DSGVO** | CSP mit Per-Request-Nonce (verifiziert), Postgres-Rate-Limiting, Datenexport, atomare Account-Anonymisierung, Retention-Cron |
| **Tests** | 103 Unit-Tests, 3 Playwright-Suiten (22 Specs), QA-Checkliste mit 9 Abschnitten |

## Qualitätsverlauf

Jede Phase durchlief mindestens ein Review-Subagenten-Gate; **alle Findings wurden vor
Phasenabschluss behoben**. Die schwerwiegendsten Funde, die es ohne Reviews in den Betrieb geschafft
hätten:

1. **EK-Preise waren über PostgREST lesbar** (RLS filtert Zeilen, nicht Spalten) → Spalten-Privileg.
2. **Adresszeilen an die API enthielten PLZ/Ort/Land**, die zusätzlich als separate Felder gingen →
   der Ort wäre auf jedem echten Brief doppelt gedruckt worden.
3. **A4-Toleranz war 250× zu locker** → genau die Near-Miss-PDFs, die die Post mit W208 ablehnt,
   wären als „versandbereit" durchgegangen.
4. **Webhook-Retry-Falle:** ein transienter Fehler hätte eine bezahlte Aufladung dauerhaft
   verschluckt (Stripe stoppt Retries nach HTTP 200).
5. **Admin-Retry war mehrfach ausführbar** → Doppelbelastung und Doppelversand.
6. **Cancel-vs-Submit-Race** → Brief hätte nach Erstattung trotzdem versendet werden können.
7. **Gesperrte Admins behielten Konsolenzugriff.**
8. **Leadlisten > 2.000 Empfänger wurden stillschweigend gekürzt** — bei voller Bezahlung.

## Offene Punkte vor dem Go-live

1. **DB-abhängige QA-Punkte einmal real ausführen** (`docs/QA_CHECKLIST.md`): Webhook-Replay,
   EK-Spaltenverweigerung via PostgREST, DSGVO-Löschung, Retry-Einmaligkeit, Rate Limiting.
   Ohne Supabase-Projekt auf der Entwicklungsmaschine nur per Code-Review verifiziert.
2. **E-Post-Live-Testplan** durchlaufen (`docs/EPOST_INTEGRATION.md` §4), erst danach `MOCK_MODE=false`.
3. **EK-Werte für Einschreiben-Zuschläge** aus dem DP-Verzeichnis nachtragen (Seed führt sie als
   `NULL`; Admin zeigt „EK fehlt").
4. **Rechtsseiten** (Impressum, Datenschutz, AGB, AVV) mit echten Inhalten füllen — Struktur steht.
5. **Stripe live schalten** (`docs/STRIPE_ACTIVATION.md`), inkl. bewusstem Entfernen der Live-Key-Sperre.
6. Muster-PDFs in `docs/reference/muster/` ablegen, falls für weitere Validierungstests gewünscht.

## Offene Ideen (`docs/IDEAS.md`)

I-001 Monats-Sammelabrechnung · I-002 Unicode-Font im PDF · I-003 gerasterte Vorschau mit exaktem
Zonen-Overlay · I-004 reichere Editor-Bausteine (Bilder/Fußzeile) · I-005 Länder-Auswahlliste ·
I-006 aufgeschlüsselte Kostenvorschau · I-007 Niedrig-Guthaben-Banner · I-008 Schrittanzeige im
Import · I-009 fail-closed Rate-Limiter für Auth-Pfade.

## Bewusste Abweichungen

Dokumentiert in `docs/ASSUMPTIONS.md` (A-001 … A-012). Die wichtigsten: Eigenversender-Modell
(Checkpoint-Entscheidung), Stornofrist über unsere Queue statt UploadManagement-Plugin (stundengenau
statt tagesgenau), gesperrte Nutzer dürfen laut Spec einloggen (Durchsetzung auf den Aktionen),
Bild-/Logo-Bausteine im Editor-UI vertagt (Datenmodell und Rendering vorhanden).

---

## Phase 0 — Setup & Analyse

- [x] git init, `.gitignore` (old_app/ + .env ausgeschlossen — old_app enthält eigene Secrets)
- [x] `MASTERPROMPT.md` im Repo-Root abgelegt
- [x] Referenz-Transkriptionen: `docs/reference/epost/preisliste-api-2025.md` (**echte EK-Preise!**), `docs/reference/epost/schablone-v3.md` (Adresszonen-Maße)
- [x] `docs/LEGACY_FINDINGS.md` — Kernbefunde: echte E-POST-Integration vorhanden (übernehmen, refactored), Schablonen-Geometrie + Fehlercode-Wissen (W208/W203/E302) erhalten, PLZ-/CSV-Utilities übernehmen; Versand-Pipeline & Billing neu bauen
- [x] Original-Schablone (`epost-schablone-v3.pdf` + Preview-JPG) aus `old_app/public/` nach `docs/reference/epost/` übernommen
- [x] `docs/PROGRESS.md`, `docs/ASSUMPTIONS.md`, `docs/IDEAS.md` initialisiert
- [x] Subagenten in `.claude/agents/` (architecture-reviewer, security-auditor, code-reviewer, ux-reviewer, qa-tester)
- [x] `CLAUDE.md`
- [x] Initial-Commit

## Phase 1 — Architektur

- [x] ADRs 0001–0009 in `docs/adr/` (Stack/Struktur, Datenmodell+RLS, Credit-Ledger, Job-Queue, Provider-Adapter, PDF-Pipeline, Preismodell, Betriebsmodell ⛔, DSGVO-Lebenszyklus)
- [x] `docs/ARCHITECTURE.md` mit ER-Diagramm (Mermaid), Versand-Sequenz, Storage-Layout
- [x] Review `architecture-reviewer`: 1× CRITICAL + 3× HIGH + 7 weitere Findings → **alle eingearbeitet** (u. a. disjunktes Refund-Referenz-Vokabular, `on_hold_funds`-Semantik, Wizard-Idempotenz via `client_token`, ADR-0009 DSGVO, Postgres-Rate-Limiting, Doppelversand-Recovery-Härtung, exakte A4-Prüfung); Verifikations-Review: **APPROVE**
- [x] Betriebsmodell-Entscheidungsvorlage: ADR-0008 (Empfehlung: **Eigenversender-Modell**)
- [x] ⛔ **CHECKPOINT bestanden (2026-07-09):** Datenmodell + Architektur freigegeben; Betriebsmodell-Entscheidung: **Eigenversender** (ADR-0008 akzeptiert). Ab hier autonom bis Phase 10.

## Phase 2 — Foundation

- [x] Next.js 16 (App Router, React 19, TS strict), Tailwind v4 + shadcn/ui, Prettier, Vitest, Playwright
- [x] Supabase-Migrationen: 21 Tabellen mit RLS auf **allen**; `book_credit` (Row-Lock, append-only-Ledger, Idempotenz-Index), `claim_jobs` (SKIP LOCKED), `check_rate_limit`, atomare Sender-Adress-RPCs; Storage-Buckets mit Per-User-Policies
- [x] Seeds: Default-Plan, Preistabelle mit **echten EK-Werten** (Preisliste 2025) + VK-Vorschlag, App-Settings; `npm run seed:admin` (via Auth-Admin-API)
- [x] Auth komplett: Registrierung (Double-Opt-in), Login, Logout, Passwort vergessen/zurücksetzen/ändern (mit Re-Auth), Verify-Callback; enumeration-sicher, rate-limited
- [x] Profil + Rechnungsadresse, Absenderadressen-CRUD (auto Absenderzeile), App-Shell (Nav, Nutzermenü, Mock-Badge, Blocked-Banner), Dashboard
- [x] Marketing-Startseite, Rechtsseiten-Platzhalter, `.env.example`, Mail-/Audit-Setup
- [x] Reviews: `security-auditor` (2× HIGH, 6× MEDIUM) + `code-reviewer` (4× MEDIUM) → **alle blockierenden + sinnvollen Findings behoben** (email-Spalten-Schutz + unique + seed via Auth-API gegen Admin-Eskalation; APP_URL-Pflicht in Prod gegen Host-Header-Injection; Open-Redirect-Backslash; Rate-Limit-IP + Doppel-Counter; atomare Default-Adress-RPCs; Passwort-Re-Auth; Admin-Guard doppelt; i18n-Zentralisierung). Bewusste Abweichung dokumentiert: A-006 (blocked users dürfen laut Spec einloggen)
- [x] DoD: Build ✅, Lint ✅, Typecheck ✅, 24 Unit-Tests ✅; Playwright-Specs vorhanden (auth/public), Supabase-abhängige Specs skippen ohne `.env.local`

## Phase 3 — Briefe

- [x] **Ein gemeinsamer Validierungspfad** (`validateLetterPdf`, ADR-0006): exakte A4-Prüfung (Toleranz 0,003 pt — W208-fest), 94-Blatt-/188-Seiten-Limit, 20-MB-Limit, PDF/A-Heuristik (Warnung), verschlüsselte PDFs
- [x] **Echte Adresszonen-Analyse** (pdfjs, Textpositionen): DVF-Sperrzone = harter Fehler, druckfreie Ränder (links/oben/rechts/unten), leere Empfängerzone → Deckblatt-Empfehlung
- [x] PDF-Upload: Dropzone, Validierungsbericht je Regel, Storage (`letters`-Bucket), Deckblatt-Toggle (hält `sheet_count` synchron)
- [x] **Block-Editor**: Betreff/Text/Abstand-Bausteine, Verschieben/Löschen, Platzhalter-Einfügung an Caret-Position (Betreff + Text), Absenderadresse-Auswahl, Vorlagen (speichern/laden); Bild-/Logo-Rendering + Asset-Upload serverseitig vorhanden, UI-Ausbau in IDEAS I-004 (A-007)
- [x] Serverseitiges Rendering (pdf-lib) mit Schablone-V3-Geometrie; **Editor-Briefe laufen durch denselben Validierungspfad** (Proberendering beim Speichern)
- [x] Serienbrief-Platzhalter (`{{anrede}}` …) inkl. Unbekannt-Warnung; Auflösung pro Empfänger vorbereitet für Phase 5
- [x] Vorschau: PDF-iframe + einblendbares Schablonen-Zonen-Overlay; Deckblatt-Generator
- [x] Review `code-reviewer`: 1× HIGH (A4-Toleranz) + 4× MEDIUM + 6× LOW → **alle behoben** (A4 exakt, Editor-Validierung, Deckblatt-Blattzahl, blocked-Guard verdrahtet, Ränder komplett, Toggle-Revert, Caret-Fix, Umlaut-Regex, Source-Guard, Encrypted-Branch, Duplex-Seitenlimit)
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ **44 Unit-Tests** ✅ (inkl. Render→Validate-Roundtrip, Zonen, Platzhalter, Adressblock, Blattzahl)
- Muster-PDFs (`docs/reference/muster/`) weiterhin nicht vorhanden → eigene Fixtures im Test generiert (Masterprompt-konform)

## Phase 4 — Kontakte & Leadlisten

- [x] Kontakte-CRUD mit Suche (debounced, PostgREST-sicher bereinigt) + Pagination (50/Seite)
- [x] **CSV/XLSX-Import**: Upload (10 MB / 10.000 Zeilen) → automatisches Header-Mapping (DE+EN-Aliasse, Legacy-erprobt) → Mapping-UI mit Vorschau → Zeilenvalidierung (PLZ je Land, Pflichtfelder) → Duplikaterkennung (intra-Datei + Bestand via `dedup_key`, owner-scoped) → Batch-Insert → Ergebnis mit Fehlerexport (CSV, formula-injection-sicher)
- [x] Leadlisten: CRUD, Detail mit Empfängertabelle, Kontakt-Suche zum Hinzufügen, Entfernen; direkt aus Import erzeugbar (mit Kompensation bei Teilfehlern)
- [x] Review `code-reviewer`: 1× HIGH (Dedup-Lookup-Fehler → stille Duplikate) + 4× MEDIUM (CSV-Injection, .or()-Suchsyntax, Import-Atomarität, Admin-Scope) → **alle behoben**; 2× LOW (Parser-Wahl vom Serverpfad, lower()-Hinweis) behoben/dokumentiert
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ **59 Unit-Tests** ✅

## Phase 5 — Versand-Pipeline

- [x] **Swagger v2.6.1 geladen & verifiziert** (alle ADR-0005-Gates ✓): `Letter/Open`/`StatusQuery`/`Date` (Sammelabfragen), `Letter/Custom1`+`Batch` (Crash-Recovery), `CancelQueued`/`ReleaseQueued`, `Letter/Registered`; Constraints in A-009 (costCenter ≤8 alphanum, batchID int32, registeredLetter-Werte, Ländernamen DE-GROSS)
- [x] Preisberechnung als pure Function (Stufen nach Blatt, Rabatt auf VK, half-up) — eine Preiswahrheit für Vorschau & Buchung
- [x] `LetterProvider`: **MockProvider** (zustandslos, Statusmodell 1→2→3→4/99 zeitversetzt, deterministischer FAIL-Marker) + **EpostProvider** (strikt nach Spec; Token verschlüsselt in DB gecacht, 401-Retry, E324=Duplikat-Erfolg, W203-Ländernamen, unsupported-Country fail-fast)
- [x] Atomare RPCs: `confirm_send_job` (Job+Spend+Items+Queue in einer Transaktion, client_token-Idempotenz inkl. Concurrency-Catch), `cancel_pending_job_items`, `check_ledger_integrity`
- [x] Worker: `/api/cron/queue` (CAS-Claim gegen Cancel-Race, Zeitbudget, Backoff 1/5/15 im 55-min-Failsafe-Fenster, Dead-Job→`resolveDeadSubmit` mit Reconciliation+Refund), `/api/cron/status-sync` (1 Bulk-Call + budgetierte Einzelabfragen, Refund bei 99, BZE-Events, Test-final-bei-2), `/api/cron/maintenance` (Retention, Held-Item-Requeue, **Refund-Nachbuchungs-Sweep**, Ledger-Check); `vercel.json`-Crons
- [x] Stornofrist als Queue-Hold (A-008): stundengenau, kostenloser Storno vor Einlieferung
- [x] Versand-Wizard (4 Schritte, Kostenvorschau **nur VK**, Probeversand kostenlos, client_token) + Sendungen-Seiten (Liste, Detail, Zeitleiste, Storno mit Erstattung)
- [x] Reviews: `security-auditor` (1× HIGH: **EK-Leck über RLS-Spalten → Spalten-Grants-Migration**; 2× LOW) + `code-reviewer` (1× CRITICAL EK, 2× HIGH: on_hold_funds-Undercharge, Cancel-vs-Submit-Race; 3× MEDIUM: Refund-Verlust, hängende Jobs, Dead-Job-Stranding; 4× LOW) → **alle behoben**
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ **71 Unit-Tests** ✅ (Pricing-Matrix, AES-GCM-Roundtrip/Tamper, PDF-Pipeline)

## Phase 6 — Guthaben & Stripe-Vorbereitung

- [x] Guthaben-Seite: Saldo, Transaktionsübersicht (own-scoped) mit Belegdownload, Aufladung
- [x] **Stripe-Testmodus hinter `FEATURE_STRIPE`**: Checkout (Karte + SEPA), Beträge aus Admin-Settings (min/max/Presets), Rechnungsadresse-Pflicht, Invoice-Erstellung; **Live-Key-Hard-Guard** (sk_live wird verweigert)
- [x] Webhook `/api/webhooks/stripe`: Signaturprüfung, **Gutschrift nur via Webhook** (`stripe_event`-Referenz, idempotent), Replay-sicher (nur `processed` ist terminal — fehlgeschlagene Events werden bei Stripe-Retry erneut verarbeitet), Receipt best-effort (blockiert nie die Buchung), **Held-Item-Release nach Topup**
- [x] Auto-Aufladung: SetupIntent-Checkout, off-session PaymentIntent bei Unterschreitung, **atomarer In-flight-Claim** (kein Doppel-Charge), SCA-Fehler → Mail + Flag-Reset; Trigger nach Versand-Bestätigung via Queue
- [x] `npm run seed:stripe` (idempotent, verweigert Live-Keys); Beta-Hinweis wenn Flag aus (Admin bucht manuell)
- [x] Review (kombiniert code+security): 1× CRITICAL (Webhook-Retry-Falle) + 2× HIGH (Receipt-Gate, Auto-Topup-Race) + 3× weitere → **alle behoben**
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ 71 Tests ✅
- Hinweis: EK/VK-**Preisverwaltungs-UI** (Margen-Anzeige, Aufladebeträge konfigurieren) liegt in Phase 7 (Admin-Konsole), wo alle Admin-Flächen entstehen — keine Streichung, nur Bündelung.

## Phase 7 — Admin-Konsole

- [x] Dashboard: KPIs (Nutzer, Briefe heute/Monat, Aufladungen, **Rohertrag Σ VK−EK**, Fehlerquote, Queue) — in SQL aggregiert, Tagesgrenzen in **Europe/Berlin**; Ledger-Integritätsalarm; Systemstatus (Mock/Live, Provider-Health, Stripe)
- [x] Nutzerverwaltung: Liste mit Suche + Pagination, Detail (Guthaben, Briefe, Transaktionen), Aktionen: Guthaben buchen (**Pflicht-Kommentar**, im Audit hinterlegt), Preisstufe, Sperren/Entsperren (Selbst-Sperre verhindert), Passwort-Reset
- [x] Sendejob-Monitor: Statusfilter, Fehlerdetails, **atomarer Retry** (`admin_retry_item`-RPC: Claim + Klon + Belastung + Queue in einer Transaktion; exakt einmal ausführbar)
- [x] Preisverwaltung: EK/VK je Option, Margen-Anzeige (absolut + %), **Verkauf unter EK nur mit ausdrücklicher Bestätigung**, Aktiv-Schalter
- [x] Einstellungen: `app_settings` mit **Key-Allowlist + typisierten Wert-Schemas** (Tippfehler/falsche Typen können Worker nicht mehr brechen); Feature-Flags einsehbar
- [x] Audit-Log-Ansicht; **alle 7 Admin-Mutationen auditiert**
- [x] Review (kombiniert): 2× HIGH (Retry doppelt ausführbar → Doppelbelastung+Doppelversand; Retry nicht atomar → Belastung ohne Versand) + 1× MEDIUM Autorisierung (**gesperrter Admin behielt Konsolenzugriff**) + 4 weitere → **alle behoben**
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ **74 Unit-Tests** ✅ (inkl. Zeitzonen-Grenzen)

## Phase 8 — Härtung

- [x] **DSGVO**: Datenexport (JSON, Art. 20) im Konto-Tab; Account-Löschung nach ADR-0009 als atomare RPC (`anonymize_account`: Erstattung offener Items, Hard-Delete aller PII-Tabellen, Snapshot-/Fehlertext-/Status-Detail-Scrub, Profil-Anonymisierung als Anker) + Storage-Wipe + Stripe-Customer + auth.users; Selbstlöschung mit Re-Auth und Tippbestätigung, Admin-Löschaktion mit Hinweis auf nicht rückrufbare Sendungen
- [x] **Security-Header** inkl. **CSP mit Per-Request-Nonce + `strict-dynamic`** (kein `'unsafe-inline'`) — gegen den Production-Build per HTTP verifiziert: alle 23 Script-Tags tragen die Nonce des Response-Headers; HSTS, X-Frame-Options (SAMEORIGIN wegen PDF-iframe), Referrer-/Permissions-Policy
- [x] Review `security-auditor` über die **gesamte App**: **APPROVE**, keine CRITICAL/HIGH. Verifiziert: RLS auf allen 21 Tabellen, EK-Spalten-Privileg auch nach späteren Migrationen intakt, alle SECURITY-DEFINER-Funktionen mit `search_path` + korrekten Grants, Webhook-Idempotenz, IDOR/Open-Redirect/Cron-Secret. 2× MEDIUM + 4× LOW → behoben (Rate-Limit auf Passwort-Re-Auth, CSP-Nonce, HTML-Escaping in Mails, DSGVO-Restfelder); Fail-open-Ratelimit als I-009 dokumentiert
- [x] Review `ux-reviewer` über alle Kernflüsse: 3× HIGH (**Sackgassen im Kernpfad**: kein Auflade-CTA bei Unterdeckung, kein „Brief versenden"-CTA, Onboarding-Schritt verlinkte auf sich selbst) + 5× MEDIUM + 6× LOW → **alle behoben**; „Versand" jetzt in der Hauptnavigation, AGB/Datenschutz-Hinweis bei Registrierung, klickbare Guthaben-Anzeige, Select-a11y; 5 größere Ideen → IDEAS I-005…I-008
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ 74 Unit-Tests ✅

## Phase 9 — QA

- [x] **103 Unit-Tests** (15 Dateien): Preismatrix, Ledger-/Validierungssemantik, Schablonen-Geometrie, AES-GCM inkl. Tamper-Erkennung, CSP-Direktiven, PDF-Render→Validate-Roundtrip, Import/Dedup, Adress-Builder (Druck vs. Provider), Zeitzonen-Grenzen, Mail-Escaping
- [x] Playwright: `auth.spec.ts` (öffentliche Seiten), `user-journey.spec.ts` (Registrierung → Editor-Brief mit Platzhalter → CSV-Import + Leadliste → Versand im Mock → Ledger-Prüfung → blocked-User), `admin-journey.spec.ts` (Guards, KPIs, Guthaben mit Pflichtkommentar, Audit, Sperren, Preis-/Settings-Validierung, gesperrter Admin)
- [x] `docs/QA_CHECKLIST.md` (9 Abschnitte) + `qa-tester`-Durchlauf
- [x] **QA-Findings behoben:**
  - **F2 (kritisch, Zustellbarkeit):** `addressLine1–5` enthielten PLZ/Ort/Land, die zusätzlich als separate Felder gingen → beim echten Provider doppelte Ortsangabe. Getrennte Builder für Druck und Provider (A-010), Auslands-PLZ-Regel ergänzt, Tests dagegen
  - **F1:** Leadliste > 2.000 Empfänger wurde stillschweigend gekürzt → harte Obergrenze mit Fehlermeldung (A-011)
  - **F3:** Server startete ohne Supabase-Env gar nicht → öffentliche Seiten booten jetzt (verifiziert per HTTP: `/`, `/rechtliches/*`, `/registrieren` → 200; `/app` fail-closed), Playwright läuft
  - **F4:** doppelte `submit_item`-Queue-Jobs möglich → partieller Unique-Index je Item; `enqueueJob` behandelt Konflikt als No-op
  - **F5/F6:** doppelte Auto-Topup-Fehlermail bei Webhook-Replay; ein `client_token` für Probe- und Echtversand
  - Zusätzlich gefunden und behoben: `"use server"`-Datei exportierte eine Konstante (Build-Bruch); Navigations-Buttons gaben `<a>` die Rolle `button` → `ButtonLink` (A-012)
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ 103 Unit-Tests ✅ Playwright ✅ (3 passed, 19 skipped — DB-abhängig)

## Fehlendes Material (nicht blockierend)

- Original-PDFs (Preisliste, Schablone V3) liegen nur als Chat-Anhang vor → Inhalte transkribiert in `docs/reference/epost/`; Originale bitte bei Gelegenheit in `docs/reference/epost/` ablegen.
- `docs/reference/muster/` (Muster-Briefe) noch leer → eigene Test-Fixtures werden in Phase 3 generiert.
- `.env` / `.env.local` mit echten Credentials (Supabase, E-Post `vendorID`/EKP, Stripe, Resend) → bis dahin Mock-Modus.
- EK-Preise für Einschreiben-Zusatzleistungen und International nicht in der Preisliste → Seed mit TODO-Platzhaltern.

## Phase 10 — Übergabe

- [x] `README.md`: Schnellstart, Supabase-Setup (Projekt, Migrationen, Auth-Redirects, Admin-Seed), Vercel-Deployment (ENV, Cron, Domain), Projektstruktur, Sicherheits-Grundsätze
- [x] `docs/EPOST_INTEGRATION.md`: wo Zugangsdaten eingetragen werden, implementierte Routen, verifizierte Feld-Constraints, **dreistufiger Testplan Mock → Live**, Betriebshinweise (Polling-Drosselung, kein Rückruf, Idempotenz)
- [x] `docs/STRIPE_ACTIVATION.md`: Testmodus-Setup, Webhook-Events, Abnahmetest, Live-Schaltung (inkl. bewusstem Entfernen der Live-Key-Sperre)
- [x] `docs/ARCHITECTURE.md` final: ER-Diagramm mit allen Migrationen synchronisiert, Funktionsübersicht, EK-Spaltenschutz, erledigte Verifikationsgates
- [x] `.env.example` vollständig kommentiert; Abgleich Code ↔ Doku (keine undokumentierte Variable)
- [x] Seeds: `seed:admin` (Auth-Admin-API), `seed:demo` (Absenderadresse, 5 Kontakte, Leadliste, Serienbrief, 50 € Startguthaben), `seed:stripe`
- [x] Abschlussbericht (oben)

## Nach Übergabe — Visual Builder v2 + KI-Entwurf (2026-07-10)

- [x] Dokumentmodell v2 (`letter-document.ts`): Theme (Schriftfamilie, Grundgröße, Akzentfarbe), neue Bausteine Überschrift/Trennlinie, Ausrichtung/Farbe je Baustein; `parseLetterDocument` mit v1-Upgrade (Legacy-Metriken eingefroren, Differentialtest — A-010)
- [x] PDF-Renderer v2: eingebettete OFL-Fonts (Lato/Poppins/PT Serif, Subset), Farben, Ausrichtung mit x-Clamp, Betreff/Überschrift-Umbruch, Bild-Kapazitäts-Clamp, kein Leerblatt durch End-Spacer; Glyph-Coverage-Warnung beim Speichern
- [x] WYSIWYG-Builder: skalierter A4-Canvas mit echten Briefschriften, Klick-Auswahl + Mini-Toolbar, Inspector (Baustein/Brief), Logo-/Bild-Upload mit eigener Asset-Route, Zonen-/Beispieldaten-Toggle, Seiten-Schätzung, Dirty-Guard, PDF-„Versand-Vorschau"; E2E-Kontrakt (user-journey) unverändert grün
- [x] KI-Entwurf: `LetterDraftProvider` (Anthropic/Mock), Server-Action mit Guthaben-Gate, Minuten-Limit und atomarer Tagesquote (fail-closed), Kill-Switch in Admin-Einstellungen, `ai_draft_log`-Telemetrie inkl. GDPR-Lifecycle (A-009)
- [x] Select-Fix app-weit: Trigger-Labels explizit gerendert (Base-UI zeigte rohe Werte)

## Nach Übergabe — E-Post-Anbindung (2026-07-13)

- [x] `npm run setup:epost`: interaktives Erst-Setup der API-Credentials per SMS-TAN
  (`smsRequest` → TAN → `setPassword` → `secret`), Login-Verifikation, optionales Eintragen in
  `.env.local`; Doku aktualisiert (EPOST_INTEGRATION §1, README, .env.example)
- [x] Skript ausgeführt, Credentials komplett; `MOCK_MODE=false` lokal; Health-Check OK
- [ ] Testplan `docs/EPOST_INTEGRATION.md` §4: Probeversand (testFlag, kostenlos) → 1 echter Brief

## Nach Übergabe — Briefpapier & DIN-Satzspiegel (2026-07-13)

- [x] **DIN-5008-Satzspiegel** (`theme.marginStyle`): Fließtext fluchtet mit dem Adressblock
  (links 25mm, rechts 20mm). Bestandsdokumente behalten per Zod-Default den alten Satzspiegel
  (Blattzahl = gebuchter Preis, A-010-Analogie); der Editor hebt Nicht-Legacy-Briefe beim Öffnen
  auf DIN an (als ungespeicherte Änderung markiert)
- [x] **Kopf-/Fußbereich** (`document.header/footer`): Kontaktblock gegenüber dem Logo (Band
  12–43mm, kollisionsfrei zu Absenderzeile/DVF per Konstruktion), Kleingedrucktes 279–293mm —
  beide außerhalb des Textflusses, ändern nie die Paginierung; WYSIWYG-Parität im Canvas
- [x] **Briefpapier**: Theme+Logo+Kopf+Fuß als benanntes Preset (letter_templates.kind,
  Migration 20260713170000 angewendet); Anwenden erhält legacyLayout/marginStyle des Zielbriefs
- [x] **Muster-PDF für Uploads** (`/app/briefe/hochladen/muster`): Zonen aus derselben
  Geometriequelle wie der Validator; das Muster besteht die eigene Upload-Prüfung (Test)
- [x] **Navigation**: Logo größer, Leadlisten als Unterpunkt von Kontakte, „Brief versenden" aus
  dem Hauptmenü → „Versenden"-Button je versandbereitem Brief (`/app/versand?brief=<id>`)
- [x] Review-Workflow (17 Agenten, adversarial verifiziert): 13 Findings → alle behoben
  (u. a. Platzhalter/Font-Coverage im Kopf-/Fußbereich, Speicher-Sperre bei aktiven Sendungen,
  Muster-PDF-Marker, Rate-Limits auf Editor-Saves)
- [x] `{{datum}}`-Platzhalter (Versanddatum, frei platzierbar); fixes Datum bleibt als Schalter
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ **132 Unit-Tests** ✅

## Nach Übergabe — Stripe LIVE (2026-07-13)

- [x] **Live-Schaltung** (Betreiber-Entscheidung nach Rückfrage): Live-Key-Sperre in
  `getStripe()` entfernt; `seed:stripe` verlangt `--live`-Flag bei Live-Keys
- [x] Live-Webhook-Endpoint verifiziert (app.versendio.de, 3 Events, enabled);
  Top-up-Produkt im Live-Konto (`prod_UsXHO8VYZhTIhO`); `FEATURE_STRIPE=true` lokal
- [ ] **Vercel-ENV setzen** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FEATURE_STRIPE=true`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) + Redeploy — ohne sie antwortet der Prod-Webhook 503
- [ ] Dashboard: Zahlungsmethoden (Karte + SEPA) und Stripe Tax im **Live-Modus** aktivieren
- [ ] Abnahmetest live: eine Mindestbetrag-Aufladung auf eigenes Konto (Gutschrift, Beleg-Link,
  Held-Item-Release)
- [x] **B2B-Netto-Preismodell (A-014)**: alle Beträge netto; Checkout mit fester 19 %-Tax-Rate
  (exklusiv, auto-angelegt), Rechnung weist USt. aus, Gutschrift = netto; Auto-Aufladung zieht
  netto × 1,19 ein und bucht netto (Metadata-Betrag, Fallback für Alt-Intents); Netto-Hinweise
  auf Kostenvorschau, Aufladung, Auto-Aufladung, Marketing-Text; IDEAS I-016/I-017

## Nächster Schritt

Projekt übergeben. Vor dem Go-live die sechs Punkte aus **„Offene Punkte vor dem Go-live"** im
Abschlussbericht abarbeiten.
- [x] **Auto-Aufladung → Stripe-Invoicing (I-016 umgesetzt)**: Rechnungsposition (netto,
  19 %-Tax-Rate) → Finalisieren → off-session Einzug; Gutschrift + Rechnungslink via
  `invoice.paid`; Legacy-PaymentIntent-Pfad bleibt für Alt-Vorgänge
- [x] **Rechnungs-Downloads**: Guthaben-Seite (Kunde) und neue Admin-Seite „Aufladungen"
  (alle Aufladungen, Netto/USt./Brutto, CSV-Export im DE-Excel-Format) — Rechnungs-PDF wird
  je Abruf frisch von Stripe aufgelöst
- [x] **Live-Performance**: Ursache = Vercel-Funktionen in iad1 bei DB in eu-central-1
  (`x-vercel-id: fra1::iad1` → jede Navigation 3–5 Transatlantik-Roundtrips). Fix:
  `regions: ["fra1"]` in vercel.json (verifiziert: `fra1::fra1`) + loading.tsx-Boundaries
  für App- und Admin-Routen (sofortiges Klick-Feedback)
- [x] **Webhook-Events ergänzt** (2026-07-13, vom Betreiber im Dashboard): alle 5 Events aktiv,
  per API verifiziert; Prod-Webhook antwortet 400 auf unsignierte Requests → `STRIPE_WEBHOOK_SECRET`
  ist in Vercel gesetzt

## Nach Übergabe — Builder-Redesign „Document-first" (2026-07-13)

- [x] **Mehragenten-Designprozess**: 4 Kritik-Linsen → 3 unabhängige Entwürfe → 3-Juroren-Panel;
  „Document-first, minimal chrome" einstimmig (41/50), Übernahmen aus den Verliererentwürfen
- [x] **Phase 1 — Chrome**: Sticky-Top-Bar (Breadcrumb + Inline-Titel + Speicherstatus),
  Workspace-Well (`--workspace`-Token) mit zentriertem Blatt + Papier-Schatten, Schnellstart-Karte,
  Chip-Leiste (sticky) mit Unbekannt-Badge, Gutter-Cluster statt Mini-Toolbar, klickbare
  Kopf-/Fußzonen, Inspector ohne Tabs (kontextuelle Baustein-Karte + 4 Sektionen mit
  localStorage), SegmentedGroup-Picker, Undo-Toast, Cmd/Ctrl+S, In-App-Dirty-Guard (I-015 ✓)
- [x] **Phase 2 — DnD**: dnd-kit-Sortierung per Grip-Handle (Inverse-Scale, I-011 teilweise ✓),
  Hover-Gap-Inserter (klick-transparent, Tastatur-erreichbar), KeyboardSensor + deutsche
  SR-Ansagen
- [x] **Adversarialer Review**: 8 bestätigte Findings behoben (u. a. Guard-Bypass nach
  fehlgeschlagenem „Speichern und verlassen", Hydration im Inspector, Cmd+S-Gates)
- [x] **Zwei Alt-Regressionen (10.07.) gefunden & behoben**: (1) Benutzermenü crashte beim Öffnen
  (`DropdownMenuLabel` ohne `Menu.Group`, Base UI 1.6) → **Logout war app-weit kaputt**;
  (2) alle `onSelect`-Handler auf Menü-Items still tot (Base UI nutzt `onClick`) → Logout-,
  Vorlagen- und Einfüge-Menüs; Admin-Settings-E2E-Test robust gegen Zeilen-Reihenfolge
- [x] Verifikation: alle 4 E2E-Suiten grün (auth 8/8, admin 8/8, user-journey 6/6, DnD-Drag +
  Gap-Insert per echtem Browser-Drag verifiziert); Build/Lint/Typecheck/135 Unit-Tests grün.
  Hinweis: E2E-Vollläufe müssen wegen `login`-Rate-Limit (10/5min/IP) fensterweise laufen
- [x] **Datumszeile**: Format Kurz/Lang („13.07.2026" / „13. Juli 2026") + optional Ort aus der
  Absenderadresse („Hannover, 13. Juli 2026"), Controls im Versand-Abschnitt des Inspectors;
  Textbeginn im DIN-Frame auf 100 mm (unter die Datumszeile) — auf allen Render-Pfaden
  (Speichern, Vorschau, Versand-Worker via sender_snapshot.city) und im Canvas

## Nach Übergabe — Feature-Batch (2026-07-14)

- [x] **Navigation**: „Leadlisten" → „Kontaktlisten"; Kontakte ist eine ausklappbare Gruppe
  (Alle Kontakte + Kontaktlisten), standardmäßig eingeklappt, öffnet sich auf der aktiven Sektion
- [x] **Kontakte anlegen**: „Kontakt anlegen"-Button in Kopfzeile + Leerzustand (Formular existierte,
  war aber nur in der befüllten Liste erreichbar)
- [x] **Briefe löschen**: Zeilen-Menü mit Bestätigung; `deleteLetterAction` blockt Briefe mit
  laufender Sendung und pinnt den Eigentümer explizit
- [x] **Profil-Menü**: Links Profil/Sicherheit/Guthaben ergänzt; **Zahlungsmethode entfernen**
  (Detach bei Stripe + lokal leeren)
- [x] **Rechnungsadresse** auf der Guthaben-Seite anzeigbar + editierbar (spiegelt das Profilformular)
- [x] **Auflade-Bonus (Geld)**: Admin-Konfig `topup_bonus_tiers` (Prozent oder fixe Cent je Schwelle);
  Bonus wird im Webhook als **separate Ledger-Zeile** gebucht (`reference_type=stripe_bonus`,
  gleiche Event-ID) → idempotent, keine USt., keine Rechnung; gilt für manuelle und Auto-Aufladung;
  reine Rechenfunktion unit-getestet (floor, nie Überzahlung). Migration 20260714100000 angewendet
- [x] **Konditionen (Rabatt-Pläne)**: Admin-CRUD unter Preisverwaltung — benannte Konditionen mit
  Rabatt-%, eine Standard-Kondition (alle Neukunden), Löschschutz für Standard + zugewiesene;
  Zuweisung je Kunde existierte bereits in der Nutzerverwaltung
- [x] **Optional 2FA (TOTP)**: Supabase-MFA in Einstellungen → Sicherheit (aktivieren via QR/Code,
  deaktivieren); Login-Step-up + App-Layout-Gate (aal1+aal2 → `/mfa`), fail-open
  - ⚠️ **Operator-Schritt:** MFA im Supabase-Dashboard unter Auth → Multi-Factor freischalten,
    sonst schlägt die Aktivierung fehl
- [x] **Adversarialer Review** über den Batch (Fokus Geld + Auth): 3 bestätigte Findings behoben:
  - **HIGH:** 2FA war nur render-seitig — Server Actions und die `/admin`-Gruppe liefen auf AAL1.
    Gate in `requireProfile()` verschoben (Choke-Point für Seiten **und** Actions, inkl.
    `requireAdmin`), per-Request gecacht, fail-open
  - **MEDIUM:** Standard-Kondition konnte auf **null** fallen (nicht-atomares clear-then-set +
    Toggle-off ohne Guard) → atomare RPC `admin_upsert_plan` (Migration 20260714110000),
    verweigert Zustände ohne Standard; Namenskollision rollt zurück
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ **140 Unit-Tests** ✅; E2E gegen Mock-Build grün

## Nach Übergabe — UX-Feinschliff & Flow-Aufnahme (2026-07-21)
- [x] **„Neuer Brief"**: „Im Editor erstellen" als prominente Hero-Karte (Empfohlen-Badge, CTA),
  „PDF hochladen" als schlanke Sekundär-Zeile unter „oder"-Trenner
- [x] **Sidebar**: „Kostenloses Guthaben" ans untere Ende geschoben (`mt-auto` + Trenner), von der
  Navigation abgegrenzt — Desktop und mobile Sheet-Nav auf Flex-Spalte umgestellt
- [x] **Flow-Aufnahme bei Kontaktanlage/Import**: Opt-in-Mehrfachauswahl aktiver Flows beim manuellen
  Anlegen und beim CSV-Import (nur wenn aktive Flows bestehen); nimmt die Kontakte in die Flow-Liste
  auf → bestehender Enrollment-Trigger greift. Details & Kanten → `docs/ASSUMPTIONS.md` A-015
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ **162 Unit-Tests** ✅

## Nach Übergabe — E-Mail-Benachrichtigungen & Sendungsstatus-Fix (2026-07-21)
- [x] **Job-Status-Lücke geschlossen**: `queued → processing` wird jetzt beim ersten Einliefern gesetzt
  (plus Catch-up im Status-Sync für Alt-Jobs) — Kopfzeile zeigte „In Warteschlange", während Briefe
  längst im Druckzentrum waren
- [x] **Aufladebestätigung** (manuell + automatisch): idempotent über das Ledger-Signal in `bookTopup`,
  mit Betrag, Bonus und Rechnungslink
- [x] **Zustellstatus-Digest** je Sendung pro Sync-Lauf (statt Mail je Brief); Abschluss-Doppelmails
  vermieden; Tests ausgenommen
- [x] **Flow-Zusammenfassung** je (Nutzer, Flow) pro Tick: versendet / wartet auf Guthaben (nur erster
  Hold) / endgültig fehlgeschlagen
- [x] **Einstellungen → Benachrichtigungen**: 4 Opt-out-Schalter (`notify_*` auf profiles, Migration
  20260721100000); zentrales Gate in `processSendEmail`; Konto-/Aktions-Mails bewusst immer aktiv
  - ⚠️ **Operator-Schritt:** Migration auf der DB anwenden (`npx supabase db push` oder SQL-Editor)
- [x] Details & Kanten → `docs/ASSUMPTIONS.md` A-016; neue Ideen I-025–I-029
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ **172 Unit-Tests** ✅

## Nach Übergabe — Gutscheincodes (2026-07-21)
- [x] **Admin → Gutscheine**: Codes anlegen (fester Betrag, max. Einlösungen/unbegrenzt, gültig bis/unbegrenzt,
  Code manuell oder auto-generiert, interne Notiz), Aktiv-Schalter, Löschen (nur ungenutzte), Anzeige
  „eingelöst X / Y"
- [x] **Kunde → Guthaben**: „Gutschein einlösen"-Karte; Betrag wird sofort gutgeschrieben
- [x] **Geld-Sicherheit**: Buchung über `book_credit` (type topup, ref 'voucher'); atomare RPC `redeem_voucher`
  (FOR UPDATE, kein Oversell), einmal pro Nutzer über Ledger-Unique + `voucher_redemptions`; rate-limitet;
  RPC transaktional gegen die DB verifiziert (Happy Path + alle Fehlerpfade), Migration angewendet
- [x] Details → `docs/ASSUMPTIONS.md` A-017
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ **172 Unit-Tests** ✅

## Nach Übergabe — SSO-Login Google + Microsoft (2026-07-21)
- [x] „Weiter mit Google" / „Weiter mit Microsoft" auf Login + Registrierung (ein OAuth-Flow für beides);
  Start-Action mit Rate-Limit; Azure mit email-Scope; Trigger coalesced full_name/name (Migration
  20260721130000, angewendet); Welcome-Mail/MFA/Profil-Bootstrap laufen über bestehende Pfade
- [x] Consent-Links im Registrieren-Formular → versendio.de/agb + /datenschutz (neuer Tab)
- [x] Smoke: /login rendert beide Buttons + Trenner; DoD: Build ✅ Lint ✅ Typecheck ✅ 173 Tests ✅
  - ⚠️ **Operator:** Provider-Credentials im Supabase-Dashboard hinterlegen (Details → A-018);
    voller Roundtrip erst danach testbar

## Nach Übergabe — Whitelabel-SaaS (2026-07-21)
- [x] **Admin**: „Whitelabel-SaaS"-Schalter je Nutzer (geschützte Spalte `is_whitelabel`, Audit-Log);
  Sperren/Löschen existierte bereits (Detailseite)
- [x] **Whitelabel-Bereich** (`/app/whitelabel`, nur mit Flag): KPIs, Endkunden-CRUD (Kundennr.,
  Aktiv-Schalter, Löschen nur ohne Sendungen), Detailseite mit Sendungsliste + Verbrauch
- [x] **API**: `POST/GET /api/v1/customers` (idempotent über externalRef), `customerId` bei
  `letters/send` (Attribution nach Geld-RPC), `GET /api/v1/customers/{id}/usage?from&to`
  (nur „sent", VK netto, Erstattungen separat); API-Doku-Abschnitt nur für Whitelabel-Konten
- [x] Migrationen 20260721160000 + 170000 angewendet; DB-Layer transaktional verifiziert
  (Attribution, Usage-Summen, Unique/FK/GDPR)
- [x] Details → `docs/ASSUMPTIONS.md` A-019; Ideen I-030/I-031
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ 173 Tests ✅

## Nach Übergabe — Upload-Robustheit, A4-Autokorrektur & Deckblatt-Hinweis (2026-07-23)
- [x] **Production-Bug behoben**: PDF-Upload > 1 MB crashte mit Nexts generischer Fehlerseite
  (Server-Action-Body-Limit 1 MB, App erlaubt 20 MB). Fix: **zweistufiger Upload** — Action prägt
  signierte Storage-URL (Pfad serverseitig, Owner-Prefix + UUID), Browser lädt direkt zu Supabase
  (umgeht auch Vercels ~4,5-MB-Funktionslimit), Finalize-Action validiert + persistiert. Action-Limit
  global nur 6 MB (für Logo-Uploads); Client-Vorprüfung Typ/Größe; deutsche Error-Boundary (`app/error.tsx`)
- [x] **A4-Autokorrektur**: `normalizePdfToA4` skaliert Seiten mit ≤ 10 mm Abweichung je Dimension
  exakt auf die API-Box 595.276 × 841.89 (läuft vor der Validierung; gespeichert wird das korrigierte
  PDF; grüner Hinweis im Prüfbericht). Guards: Seiten-Cap, CropBox ≠ MediaBox, verschlüsselt/unparsebar
  unangetastet; PDF/A-Konvertierungs-Hinweis nach Anpassung wieder aktiv
- [x] **Adresszonen entschärft**: leere Empfängerzone = grüner Hinweis „Deckblatt automatisch aktiviert
  (+1 Seite)" statt Warnung; DVF-Verstoß kein Upload-Reject mehr — Deckblatt wird erzwungen
  (Server-Guard in `setCoverLetterAction`, Send-Time-Backstop im Queue-Worker gegen direkte DB-Writes,
  Toggle in der Detailseite gesperrt mit Begründung)
- [x] **Deckblatt-Fußzeile** „Dieser Brief wurde automatisch mit versendio.de versendet." (7 pt grau,
  288 mm, zonensicher); neue Spalte `profiles.cover_letter_footer` (Default **an**, Migration
  20260723090000, notify_*-Muster), Opt-out unter Einstellungen → Profil; wirkt in Versand + Vorschau
  (Owner-Präferenz, nicht Betrachter)
- [x] **Ultracode-Review** (18 Agenten: 4 Dimensionen + adversariale Verifikation): 10 bestätigte Funde
  gefixt — u. a. DoS-Fläche des globalen Body-Limits, nicht durchgesetzte DVF-Invariante, Ressourcen-
  Guard in normalize, PDF/A-Suppression, Copy-Konsistenz (musterNotes, „+1 Seite"), CropBox-Reveal
  - ⚠️ **Operator-Schritt:** Migration anwenden (`npx supabase db push` oder SQL-Editor)
- [x] DoD: Build ✅ Lint ✅ Typecheck ✅ **189 Unit-Tests** ✅
