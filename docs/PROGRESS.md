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
| 5 | Versand-Pipeline (Queue, Provider, Polling) | ⬜ offen |
| 6 | Guthaben, Preise & Stripe-Vorbereitung | ⬜ offen |
| 7 | Admin-Konsole | ⬜ offen |
| 8 | Härtung (Security, DSGVO, UX) | ⬜ offen |
| 9 | QA | ⬜ offen |
| 10 | Übergabe | ⬜ offen |

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

## Fehlendes Material (nicht blockierend)

- Original-PDFs (Preisliste, Schablone V3) liegen nur als Chat-Anhang vor → Inhalte transkribiert in `docs/reference/epost/`; Originale bitte bei Gelegenheit in `docs/reference/epost/` ablegen.
- `docs/reference/muster/` (Muster-Briefe) noch leer → eigene Test-Fixtures werden in Phase 3 generiert.
- `.env` / `.env.local` mit echten Credentials (Supabase, E-Post `vendorID`/EKP, Stripe, Resend) → bis dahin Mock-Modus.
- EK-Preise für Einschreiben-Zusatzleistungen und International nicht in der Preisliste → Seed mit TODO-Platzhaltern.

## Nächster Schritt

Phase 5 — Versand-Pipeline: Swagger-Spec per WebFetch laden (Verifikationsgates ADR-0005 §4), Preisberechnung, Versand-Assistent inkl. Probeversand, Job-Queue-Worker (`/api/cron/*`), MockProvider + EpostProvider, Status-Polling, Credit-Buchung/-Erstattung. Reviews: code-reviewer + security-auditor.
