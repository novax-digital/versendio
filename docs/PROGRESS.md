# PROGRESS

> Laufender Projektfortschritt. Bei Session-Wiederaufnahme: zuerst `MASTERPROMPT.md`, dann dieses Dokument, dann `docs/ASSUMPTIONS.md` lesen.

## Phasenübersicht

| Phase | Titel | Status |
|---|---|---|
| 0 | Setup & Analyse | ✅ abgeschlossen |
| 1 | Architektur (⛔ Checkpoint) | 🔄 in Arbeit |
| 2 | Foundation (Scaffold, Supabase, Auth) | ⬜ offen |
| 3 | Briefe (Upload, Editor, PDF-Pipeline) | ⬜ offen |
| 4 | Kontakte & Leadlisten | ⬜ offen |
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

## Fehlendes Material (nicht blockierend)

- Original-PDFs (Preisliste, Schablone V3) liegen nur als Chat-Anhang vor → Inhalte transkribiert in `docs/reference/epost/`; Originale bitte bei Gelegenheit in `docs/reference/epost/` ablegen.
- `docs/reference/muster/` (Muster-Briefe) noch leer → eigene Test-Fixtures werden in Phase 3 generiert.
- `.env` / `.env.local` mit echten Credentials (Supabase, E-Post `vendorID`/EKP, Stripe, Resend) → bis dahin Mock-Modus.
- EK-Preise für Einschreiben-Zusatzleistungen und International nicht in der Preisliste → Seed mit TODO-Platzhaltern.

## Nächster Schritt

Phase 1: ADRs + Datenmodell + ER-Diagramm in `docs/ARCHITECTURE.md`, Review durch `architecture-reviewer`, dann ⛔ Checkpoint (Freigabe Datenmodell + E-Post-Betriebsmodell).
