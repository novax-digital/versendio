# E-POST-Integration: Umstieg Mock → Live

> Provider: **E-POSTBUSINESS API** der Deutschen Post (technischer Betrieb: DocuGuide).
> Verbindliche Referenz: <https://api.epost.docuguide.com/swagger/index.html> (v2.6.1 verifiziert).
> Betriebsmodell: **Eigenversender** — ein zentraler Account, `costCenter` je Kunde (ADR-0008).

---

## 1. Wo die Zugangsdaten eingetragen werden

Ausschließlich als Umgebungsvariablen (lokal `.env.local`, in Produktion Vercel → Settings →
Environment Variables). **Nie im Code, nie in der Datenbank, nie im Repository.**

```bash
EPOST_BASE_URL=https://api.epost.docuguide.com   # Entwicklungs-URL siehe Vertrag
EPOST_VENDOR_ID=                                  # vendorID aus dem API-Nutzervertrag
EPOST_EKP=                                        # Ihre DP-Kundennummer (EKP)
EPOST_PASSWORD=                                   # API-Passwort (aus dem Erst-Setup)
EPOST_SECRET=                                     # secret (aus dem Erst-Setup)
EPOST_CREDENTIALS_KEY=                            # 32 Byte base64: openssl rand -base64 32
MOCK_MODE=false                                   # erst umlegen, wenn Abschnitt 4 bestanden ist
```

`EPOST_CREDENTIALS_KEY` verschlüsselt den gecachten 24-h-Token in der Tabelle `epost_tokens`
(AES-256-GCM). Fehlt eine der vier E-Post-Variablen, schaltet die Anwendung **automatisch** in den
Mock-Modus zurück — auch bei `MOCK_MODE=false`. Der effektive Modus steht im Admin-Systemstatus.

### Erst-Setup des API-Passworts (einmalig, falls noch nicht geschehen)

Die Anwendung nutzt den fertigen Zugang. Das initiale Passwort und das `secret` werden einmalig
über die API erzeugt:

1. `POST /api/Login/smsRequest` mit `{vendorID, ekp}` → SMS-TAN an die bei der Post hinterlegte
   Mobilnummer.
2. `POST /api/Login/setPassword` mit `{vendorID, ekp, newPassword, smsCode}` → Antwort enthält das
   `secret`.
3. `newPassword` → `EPOST_PASSWORD`, `secret` → `EPOST_SECRET`.

---

## 2. Was der Adapter implementiert

`src/lib/server/providers/epost.ts`, strikt gegen Swagger v2.6.1:

| Zweck | Route |
|---|---|
| Login (24-h-JWT, verschlüsselt in `epost_tokens` gecacht) | `POST /api/Login` |
| Einlieferung (einzeln, `ActivateDuplicateFailsafe=true`, `custom1 = send_job_item.id`) | `POST /api/Letter` |
| Status einzeln | `GET /api/Letter/{letterID}` |
| Status Sammelabfrage (Polling-Drosselung) | `GET /api/Letter/Open` |
| Crash-Reconciliation (nie blinder Resubmit) | `GET /api/Letter/Custom1?custom1=…` |
| Probeversand-PDF (48 h) | `GET /api/Letter/TestResult?letterID=…` |
| Sammelkorb stornieren / freigeben | `POST /api/Letter/CancelQueued` / `ReleaseQueued` |
| Health-Check (ohne Login) | `GET /api/Login/HealthCheck` |

### Verifizierte Feld-Constraints (ASSUMPTIONS A-009, A-010)

- `costCenter`: **max. 8 Zeichen**, nur `[0-9a-zA-Z]` → `profiles.cost_center` (8 Hex der User-ID).
- `batchID`: **int32** → `send_jobs.provider_batch_id`.
- `registeredLetter`: `'Einwurf Einschreiben'` | `'Einschreiben'` | `'Einschreiben Rückschein'`.
- `country`: deutscher Ländername in GROSSBUCHSTABEN (`ÖSTERREICH`), **bei Inlandssendungen
  weglassen** (sonst Fehler W203). Nicht unterstützte Länder werden vorab abgelehnt.
- `addressLine1–5`: **nur** Name/Firma, Straße, Adresszusatz — **keine** PLZ/Ort/Land. Diese kommen
  aus den separaten Feldern `zipCode`/`city`/`country`. (Beides zusammen druckt den Ort doppelt.)
- `zipCode`: bei Auslandsadressen ohne PLZ **drei Leerzeichen**.
- `fileName`: 5–200 Zeichen, eindeutig, keine Sonderzeichen.
- PDF: **PDF/A-1b**, base64, ≤ 20 MB, A4-MediaBox exakt `[595.276, 841.89]` (595.28 → W208).

### Statusmodell

`1 Angenommen → 2 Geprüft → 3 Druckzentrum → 4 Produziert/Versendet` bzw. `99 Fehler` (final).
**Nur Status 4 wird von der Post abgerechnet.** Status 99 löst automatisch eine Guthaben-Erstattung
aus. Es gibt **keine Webhooks** — der Status kommt über gedrosseltes Cron-Polling.

---

## 3. Vorbereitung vor dem Live-Test

- [ ] `docs/reference/epost/preisliste-api-2025.md` mit dem aktuellen Vertrag abgleichen; EK-Werte
      im Admin unter **Preise** prüfen.
- [ ] **EK für Einschreiben-Zuschläge nachtragen** (im Seed als `NULL`/TODO): Werte aus dem
      DP-Verzeichnis „Leistungen und Preise". Der Admin zeigt „EK fehlt" an, die Marge bleibt bis
      dahin unberechnet.
- [ ] Verkaufspreise (VK) festlegen; die Anwendung verweigert aktive Optionen mit VK < EK ohne
      ausdrückliche Bestätigung.
- [ ] Absenderadresse mit korrekter **einzeiliger Absenderzeile** anlegen (Pflicht; bei Einschreiben
      mit Rückschein zugleich Rücksendeadresse).
- [ ] `EPOST_CREDENTIALS_KEY` gesetzt und gesichert (Rotation erfordert Neu-Login, kein Datenverlust).
- [ ] Kein IP-Whitelisting beauftragt (Vercel-Egress ist dynamisch).

---

## 4. Testplan Mock → Live

Die **Entwicklungsumgebung der API ist kostenlos und versendet nicht physisch.** Zuerst dort testen.

### Stufe 1 — Entwicklungsumgebung, `testFlag` (kein Druck)

1. `EPOST_BASE_URL` auf die Entwicklungs-URL setzen, Credentials eintragen, `MOCK_MODE=false`.
2. Admin → Dashboard: **Provider-Status** muss „OK" zeigen (Health-Check ohne Login).
3. Im Versand-Assistenten einen **Probeversand** starten (kostenlos, `testFlag`).
4. Erwartung: Item erreicht Status `2 Geprüft` und bleibt dort (Test ist damit final).
   Keine Guthaben-Buchung im Ledger.
5. Fehlerfälle bewusst provozieren:
   - PDF mit Inhalt im DVF-Sperrbereich → wird bereits von unserer Validierung abgelehnt.
   - Adresse mit falscher PLZ-Ort-Kombination → Provider antwortet mit Fehler; Item geht auf 99,
     Erstattung erfolgt automatisch (bei Testläufen ohne Buchung).

### Stufe 2 — Entwicklungsumgebung, echte Einlieferung ohne Druck

1. Einen **echten** (nicht Test-) Versand mit **einem** Empfänger auslösen.
2. Prüfen:
   - [ ] `send_job_items.provider_letter_id` ist gesetzt.
   - [ ] Ledger enthält genau **eine** `spend`-Buchung (`job_confirm`).
   - [ ] `/api/cron/status-sync` (manuell mit `CRON_SECRET` aufrufen) zieht den Status nach.
   - [ ] Zeitleiste zeigt die Statusübergänge.
3. **Doppelversand-Test:** Versand-Button doppelt klicken → nur **ein** Job, **eine** Buchung
   (`client_token`-Idempotenz).
4. **Storno-Test:** Versand mit Verzögerung („In 4 Stunden") anlegen, sofort stornieren →
   Guthaben vollständig erstattet, keine Einlieferung.

### Stufe 3 — Produktivumgebung, ein echter Brief

1. `EPOST_BASE_URL` auf die Produktions-URL, Produktiv-Credentials.
2. **Einen** Brief an eine eigene Adresse senden.
3. Prüfen:
   - [ ] Adressblock sitzt im Sichtfenster; Ort erscheint **genau einmal**.
   - [ ] Absenderzeile einzeilig oberhalb des DVF-Bereichs.
   - [ ] Keine Falzmarken doppelt (die Post druckt sie selbst).
   - [ ] Status läuft bis `4` (1–2 Tage Versatz); `frankierID` erscheint.
   - [ ] Rohertrag im Admin-Dashboard entspricht VK − EK.
4. Erst danach `MOCK_MODE=false` in Produktion für alle Nutzer.

### Rückweg

Bei Problemen jederzeit `MOCK_MODE=true` setzen und neu deployen. Laufende Sendungen mit
`provider_letter_id` werden dann nicht mehr gepollt — zum Nachziehen kurzzeitig zurückschalten.

---

## 5. Betrieb

- **Polling-Frequenz:** Die API überwacht die Abfragefrequenz. `/api/cron/status-sync` macht **einen**
  Sammelaufruf (`Letter/Open`) plus maximal `status_sync_max_queries_per_run` Einzelabfragen
  (Admin → Einstellungen, Default 50). Nicht ohne Not erhöhen.
- **Wartungsfenster** der Post erscheinen in der Health-Check-Antwort und damit im Admin-Dashboard.
- **Kein Rückruf nach Einlieferung.** Das Stornofenster entsteht in *unserer* Queue
  (`scheduled_release_at`, stundengenau) — bis zur Einlieferung ist Storno kostenlos.
- **Fehlgeschlagene Briefe (99)** werden automatisch erstattet. Ein Retry im Admin klont das Item,
  belastet erneut und liefert neu ein — genau einmal ausführbar.
- **Idempotenz bei Timeouts:** `ActivateDuplicateFailsafe` (60-Minuten-Fenster, Fehler E324) plus
  `custom1`-Lookup. Retries bleiben bewusst innerhalb dieses Fensters (1/5/15 min, max. 3 Versuche).
  Lässt sich eine Einlieferung danach nicht bestätigen, wird das Item **erstattet und markiert**,
  statt ein Doppelversand-Risiko einzugehen.

## 6. Alternative Anbieter

Der Versand läuft hinter dem Interface `LetterProvider` (`src/lib/server/providers/types.ts`).
Ein weiterer Anbieter (LetterXpress, Pingen …) benötigt nur einen neuen Adapter plus einen Eintrag
in `getLetterProvider()`. Domänencode, Preisberechnung und Ledger bleiben unberührt.
