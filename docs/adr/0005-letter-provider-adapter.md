# ADR-0005: LetterProvider-Adapter, Token-Handling & Credential-Verschlüsselung

**Status:** akzeptiert · **Datum:** 2026-07-09

## Kontext
Versand läuft über die E-POSTBUSINESS API (DocuGuide); später sollen alternative Anbieter (LetterXpress, Pingen) andockbar sein. Ohne Credentials/im Dev-Betrieb muss alles im Mock laufen. Die Legacy-App cachte das 24-h-JWT im Modulspeicher — auf Serverless bedeutet das Re-Login bei jedem Cold Start (Frequenz-Risiko beim Login-Endpoint).

## Entscheidung
1. **Interface `LetterProvider`** (in `lib/server/providers/types.ts`):
   `submitLetter(item)`, `submitTest(item)`, `getStatus(providerLetterId)`, `listOpenLetters(range?)`, `getTestResult(providerLetterId)`, `cancelQueued(providerLetterId)`, `releaseQueued(providerLetterId)`, `healthCheck()`.
   Ein-/Ausgaben sind **provider-neutrale** Typen (unser Statusmodell, unsere Fehlercodes); das E-Post-Statusmodell (1/2/3/4/99) wird als generisches `accepted|checked|print_center|sent|failed` gemappt — E-Post-Spezifika bleiben im Adapter.
2. **Provider-Auswahl** in `getLetterProvider()`: `MOCK_MODE=true` **oder** unvollständige E-Post-ENV → `MockProvider`; sonst `EpostProvider`. Der effektive Modus wird als Systemstatus exponiert (UI-Badge + Admin).
3. **`MockProvider`:** persistiert simulierte Sendungen inkl. zeitversetzter Statusübergänge 1→2→3→4 (Minutentakt, konfigurierbar) und ~2 % zufälliger 99-Fehler (Quote in `app_settings`, für QA deterministisch per Empfänger-Marker `FAIL` erzwingbar). Fake-`letterID`s mit Präfix `MOCK-`. Test-PDF-Abruf liefert das gerenderte PDF mit Sperrflächen-Overlay.
4. **`EpostProvider`:** implementiert in Phase 5 strikt gegen die Swagger-Spezifikation (per WebFetch laden, nicht raten). Verifizierte Eckpunkte aus Legacy + FAQ: Login `POST /api/Login {vendorID, ekp, secret, password}` → 24-h-JWT; Einlieferung einzeln mit `ActivateDuplicateFailsafe=true`, `custom1 = send_job_item.id`; bei DE-Sendungen `country` weglassen (W203); `batchID = send_jobs.batch_id`. **Einschreiben nutzen eine eigene Statusroute (`Letter/Registered`)** — `getStatus`/`listOpenLetters` verzweigen anhand `registered`-Option; der `MockProvider` bildet beide Routen nach. **Phase-5-Verifikationsgates gegen Swagger:** (a) Sammel-Statusabfrage (offene Sendungen / Zeitraum) für die Polling-Drosselung, (b) Lookup per `custom1`/`batchID` für die Crash-Recovery (ADR-0004 §5), (c) UploadManagement-Routen (`CancelQueued`/`ReleaseQueued`), (d) `costCenter`-Feld inkl. Längenlimit.
5. **Token-Cache in der DB** (`epost_tokens`, verschlüsselt) statt Modulspeicher: jede Instanz liest den gültigen Token; Refresh nur, wenn `expires_at` < 30 min entfernt, serialisiert über `pg_advisory_xact_lock` (verhindert Login-Sturm paralleler Worker). Modulspeicher bleibt als L1-Cache innerhalb einer Invocation.
6. **Credential-Verschlüsselung:** AES-256-GCM (Node `crypto`), Schlüssel aus `EPOST_CREDENTIALS_KEY` (32 Byte, base64). Speicherformat versioniert: `v1:<iv>:<authTag>:<ciphertext>` (base64-Segmente) — Schlüsselrotation später möglich. Gilt für `epost_accounts.password_enc/secret_enc` und `epost_tokens.token_enc`. Klartext-Werte tauchen nie in Logs, Fehlermeldungen oder API-Antworten auf.
7. **Fehlertaxonomie:** Adapter übersetzen Provider-Fehler in `ProviderError { code, retryable, providerCode, message }`. Queue-Worker entscheidet anhand `retryable` über Retry vs. endgültiges Failed+Refund. E324 (Duplikat) wird als **Erfolg** des vorherigen Versuchs behandelt (Status nachziehen statt Fehler).

## Konsequenzen
- Neue Anbieter = neuer Adapter + Registry-Eintrag; Domänencode bleibt unberührt.
- Mock ist der Standard-Entwicklungsmodus; E2E-Tests laufen komplett gegen Mock.
- Kein Login-Endpoint-Spam trotz Serverless (DB-Token + Advisory-Lock).
