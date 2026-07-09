# ADR-0009: Datenlebenszyklus & DSGVO — Löschung, Anonymisierung, Retention

**Status:** akzeptiert · **Datum:** 2026-07-09

## Kontext
§6.8 verlangt: Account-Löschung entfernt personenbezogene Daten, **Abrechnungsdaten bleiben anonymisiert erhalten**; Brief-PDFs werden nach `LETTER_RETENTION_DAYS` gelöscht. Das Datenmodell muss dafür definieren, welche FKs die Löschung überleben und was genau anonymisiert wird — sonst kollidiert die Löschung mit den Aufbewahrungspflichten (oder cascaded sie weg).

## Entscheidung

### 1. Anonymisierung statt Hard-Delete des Profils
- `profiles.id` = `auth.users.id`, aber **ohne FK-Constraint auf `auth.users`** — die Profilzeile überlebt die Löschung des Auth-Users als anonymisierter Anker für Abrechnungsdaten.
- **Löschablauf** (Server Action → eine Transaktion + Storage-Cleanup-Jobs):
  1. Laufende Jobs abbrechen (nicht eingelieferte Items → `job_cancel_rest`-Refund; bereits eingelieferte laufen aus, Status-Sync bleibt aktiv bis final).
  2. **Hard-Delete** der Personendaten-Tabellen: `contacts`, `lead_lists`(+entries), `letters`, `letter_templates`, `sender_addresses`, `epost_accounts`, `billing_accounts` (Stripe-Customer wird zusätzlich via API gelöscht), `rate_limits`-Einträge.
  3. **Storage-Wipe:** alle Objekte unter `{user_id}/` in `letters`, `assets`, `imports` (als `cleanup_storage`-Jobs, mit Abschlusskontrolle).
  4. **Anonymisieren:** `profiles` → PII-Spalten (Name, Firma, Rechnungsadresse) genullt, `status='deleted'`, `deleted_at=now()`; `send_job_items.recipient_snapshot` → ersetzt durch `{anonymized: true}` (Empfängeradressen sind Personendaten Dritter; für die Abrechnung genügen Stückzahl/Preise), `rendered_pdf_path` genullt; `send_jobs.sender_snapshot` analog anonymisiert.
  5. `auth.users`-Zeile löschen (Login tot), Bestätigungs-Mail an die alte Adresse.
- **Erhalten bleiben** (anonymisiert, für Buchhaltung/Rohertrag): `credit_transactions` vollständig, `send_jobs`/`send_job_items` mit Preis-/Status-/Zählfeldern, `status_events`, `audit_log`.

### 2. FK-`ON DELETE`-Matrix (explizit)
| FK | Verhalten | Begründung |
|---|---|---|
| `*.user_id → profiles` (alle Tabellen mit user_id-FK) | **RESTRICT** | Profil wird nie gelöscht, nur anonymisiert — RESTRICT dokumentiert das und verhindert versehentliche Kaskaden |
| `send_job_items.job_id → send_jobs` | CASCADE | Items ohne Job sind bedeutungslos |
| `status_events.item_id → send_job_items` | CASCADE | dito |
| `lead_list_entries.{list_id,contact_id}` | CASCADE | Einträge folgen Liste/Kontakt |
| `send_job_items.contact_id → contacts` | SET NULL | Historie lebt im Snapshot weiter |
| `send_jobs.letter_id → letters` | DB-seitig **SET NULL**; „nicht löschen solange Job offen“ wird app-seitig im normalen Nutzer-Löschpfad geprüft | Items tragen eigene PDF-Pfade/Snapshots — die Einlieferung hängt nach Job-Anlage nicht mehr am Brief; beim Account-Löschablauf (§1) dürfen Briefe auch bei noch offenen Jobs weg |
| `profiles.plan_id → plans` | RESTRICT (Plan mit Nutzern nicht löschbar, nur deaktivierbar) | Preisintegrität |

### 3. Retention (Cron `maintenance`, täglich)
- **Versand-PDFs** (`letters/{user}/jobs/…`): Löschung `LETTER_RETENTION_DAYS` (Default 30) nach finalem Status (`sent`-Zeitpunkt bzw. `failed`); `rendered_pdf_path` wird genullt, `status_events` bleiben.
- **Import-Dateien** (`imports`): nach 24 h.
- **`webhook_events`-Payloads**: nach 90 Tagen auf Metadaten reduziert (Payload kann PII enthalten).
- **`rate_limits`**: Fenster älter 24 h.
- **`job_queue`** `done` nach 7 Tagen, `dead` nach 90 Tagen (nach Admin-Report).

### 4. Datenexport (DSGVO Art. 20)
Server Action erzeugt JSON-Export (Profil, Absenderadressen, Kontakte, Listen, Briefe-Metadaten, Jobs/Items inkl. Snapshots, Ledger) + signierte Kurzzeit-URLs der noch vorhandenen PDFs; Auslieferung als Download im Profil.

## Konsequenzen
- Kein FK verhindert oder kaskadiert die Account-Löschung falsch; der Ablauf ist deterministisch und testbar (E2E-Test in Phase 8/9: löschen → Login unmöglich, PII weg, Ledger-Summen unverändert).
- Empfängerdaten Dritter verschwinden mit der Account-Löschung bzw. via Snapshot-Anonymisierung — wir halten keine Adressdaten länger als nötig.
