# MASTERPROMPT: E-Post-Mailer SaaS — Kompletter Neuaufbau

> **Verwendung:** Diese Datei liegt im Repo-Root. Sie ist die verbindliche Arbeitsgrundlage für Claude Code.
> **Session-Wiederaufnahme:** Wird eine neue Session gestartet, lies zuerst `MASTERPROMPT.md`, `docs/PROGRESS.md` und `docs/ASSUMPTIONS.md` und arbeite an der nächsten offenen Stelle weiter.

---

## 1. Deine Rolle & Arbeitsweise

Du bist Lead Software Engineer und Architekt dieses Projekts. Du baust die Anwendung eigenständig, vollständig und production-ready — Qualität vor Geschwindigkeit. Du arbeitest in den unten definierten Phasen und nutzt spezialisierte Subagenten für Reviews.

**Grundregeln:**

1. **Autonomie:** Stoppe nur bei echten Blockern (fehlende Credentials, widersprüchliche Anforderungen). Alle anderen Entscheidungen triffst du selbst und dokumentierst sie mit Begründung in `docs/ASSUMPTIONS.md`.
2. **Ein Pflicht-Checkpoint:** Nach Phase 1 (Architektur) stoppst du einmalig und legst mir Datenmodell + Architekturentscheidungen kompakt zur Freigabe vor. Danach arbeitest du autonom bis zum Ende durch.
3. **Subagenten-Reviews:** Nach jeder Phase läuft mindestens ein passender Review-Subagent über das Ergebnis. Findings werden **vor** Phasenabschluss behoben, nicht aufgeschoben.
4. **Eigene Ideen erwünscht:** Wenn dir oder einem Subagenten sinnvolle Verbesserungen auffallen: kleine, risikoarme Ideen direkt umsetzen; größere Ideen in `docs/IDEAS.md` sammeln (mit Aufwand/Nutzen-Einschätzung), nicht ungefragt umsetzen.
5. **Keine Attrappen:** Außer den zwei explizit vorbereiteten Live-Integrationen (Stripe live, E-Post live) wird nichts als Platzhalter implementiert. Jede Funktion ist end-to-end nutzbar — notfalls im Mock-Modus.
6. **Fortschritt & Commits:** Führe `docs/PROGRESS.md` (Phase, Status, offene Punkte). Committe nach jedem abgeschlossenen Arbeitspaket mit Conventional Commits (`feat:`, `fix:`, `chore:` …).
7. **Sprache:** UI-Texte Deutsch (Sie-Form), Code/Kommentare/Commits Englisch. UI-Texte zentral halten (i18n-fähige Struktur, auch wenn vorerst nur Deutsch).
8. **Definition of Done je Phase:** Build grün, Lint + Typecheck grün, relevante Tests grün, Review-Findings behoben, `PROGRESS.md` aktualisiert, committet. Erst dann nächste Phase.

---

## 2. Produktvision

**E-Post-Mailer** (Arbeitstitel, Name via `APP_NAME` in ENV) ist eine SaaS-Plattform, mit der Kunden physische Briefe digital versenden:

- Brief als **PDF hochladen** oder im **Editor selbst erstellen** (inkl. Bilder, per Drag & Drop anordnen)
- Empfänger **einzeln anlegen** oder als **Leadliste (CSV/XLSX) importieren**
- Versand als echter Brief über die **Deutsche Post E-POST API** (Schnittstellendaten folgen)
- **Statusverfolgung** je Brief; **Nutzung kostenlos, Abrechnung rein transaktional pro Brief** über Prepaid-Guthaben, Stripe-Zahlungen vorbereitet
- Zielgruppe: KMU, Agenturen, Vertriebsteams (Mailings & Serienbriefe), Markt DACH, DSGVO-konform

---

## 3. Referenzmaterial

| Pfad | Inhalt | Status |
|---|---|---|
| `./old_app/` | Alte Lovable-Codebase — **nur Referenz** für Features/UX-Ideen. Keinen Code ungeprüft übernehmen. | vorhanden |
| `docs/reference/muster/` | Muster-PDFs (echte Beispielbriefe) für Validierung, Editor-Layout und Tests | wird bereitgestellt |
| https://api.epost.docuguide.com/swagger/index.html | **E-POSTBUSINESS API** — Swagger/OpenAPI (verbindliche technische Referenz; in Phase 5 per WebFetch lesen) | online |
| https://api.epost.docuguide.com/generalcontent/EpostApi/Faq | E-POSTBUSINESS API — technische FAQ (Auth-Flow, Statusmodell, Formatvorgaben, Plugins) | online |
| `docs/reference/epost/` | Ergänzende Unterlagen (API-Nutzervertrag, `vendorID`, Zugangsdaten-Hinweise) | Preisliste + Schablone V3 transkribiert |
| `.env` / `.env.local` | Credentials (Supabase, E-Post, Stripe, Mail) | folgt später |

Fehlt Material: kurz in `PROGRESS.md` vermerken, mit Mock/Annahmen weiterbauen — **nicht blockieren**.

---

## 4. Tech-Stack (verbindlich)

- **Next.js** (aktuelle stabile Version, App Router, TypeScript `strict`), Server Components, Route Handlers & Server Actions
- **Supabase**: Auth, Postgres (RLS auf **allen** Tabellen), Storage (private Buckets, signierte URLs)
- **Tailwind CSS + shadcn/ui** — saubere, moderne B2B-Optik, responsive, Dark Mode optional
- **PDF**: `pdf-lib` für Analyse/Manipulation/Generierung (Seitenzahl, A4-Check, Deckblatt, Editor-Rendering); pdf.js/react-pdf für Browser-Vorschau
- **Validierung**: Zod (serverseitig verpflichtend) + react-hook-form
- **Stripe SDK** (vorbereitet, hinter Feature-Flag)
- **Mail**: Auth-Mails über Supabase; transaktionale Mails über Resend (Fallback SMTP via ENV)
- **Tests**: Vitest (Unit), Playwright (E2E); ESLint + Prettier
- **Deployment**: **Vercel** (verbindliches Ziel) — Konfiguration Vercel-nativ: `vercel.json` für Cron-Jobs, ENV-Variablen Vercel-kompatibel, keine Abhängigkeiten, die Serverless nicht kann
- **Hintergrundjobs**: DB-basierte Job-Queue (Tabelle) + Worker als Route Handler, getriggert über Vercel Cron (`CRON_SECRET`); idempotent, Retry/Backoff, **kleine Batches je Lauf** (Serverless-Timeouts beachten)

Keine zusätzlichen kostenpflichtigen Fremd-Services ohne ENV-Fallback einführen.

---

## 5. Datenmodell (Richtschnur — Verfeinerung in Phase 1 erlaubt)

- `profiles` (User-Stammdaten, Firma, Rechnungsadresse, Rolle `user|admin`, Status `active|blocked`)
- `sender_addresses` (Absenderadressen je User, eine Default — für Briefkopf/Adressfeld)
- `epost_accounts` (E-Post-Zugangsdaten: EKP, Passwort & `secret` **verschlüsselt gespeichert**; je Kunde beim Partner-Modell oder ein zentraler Datensatz beim Eigenversender-Modell, siehe 6.5)
- `plans` (optionale Preisstufen/Rabattgruppen, admin-zuweisbar, Default „Standard“ — **kein Abo-Modell**)
- `credit_transactions` (unveränderliches Ledger: `topup|spend|refund|admin_adjust`, Betrag, Referenz, Kommentar)
- `letters` (Dokumente: `source: upload|editor`, Storage-Pfad, Seitenzahl, Format-Checks, Status `draft|ready`)
- `letter_templates` (gespeicherte Editor-Vorlagen inkl. Briefkopf/Logo)
- `contacts` (Adressbuch: Anrede, Name, Firma, Adresse, Land)
- `lead_lists` + `lead_list_entries`
- `send_jobs` (Batch: Brief × Empfängerauswahl, Optionen, Kostensumme, Status)
- `send_job_items` (einzelner Brief an einzelnen Empfänger: Status, Provider-`letterID`, **Preis-Snapshot EK + VK**, Fehlergrund)
- `status_events` (Zeitleiste je Item)
- `pricing_table` (je Option **Einkaufspreis und Verkaufspreis in Cent**: Porto-Stufen nach Blattzahl, S/W vs. Farbe, Simplex/Duplex, Zusatzblatt, Einschreiben-Varianten — im Admin editierbar; EK-Werte der Post werden später nachgetragen)
- `webhook_events` (eingehende Stripe-Webhooks, idempotente Verarbeitung; E-Post liefert keine Webhooks → Status-Sync per Polling)
- `audit_log` (alle Admin-Aktionen)
- `settings` / `feature_flags`

ER-Diagramm als Mermaid in `docs/ARCHITECTURE.md` pflegen.

---

## 6. Funktionsumfang

### 6.1 Auth & Konto
- Registrierung mit E-Mail-Verifizierung (Double-Opt-in), Login, Logout
- **Passwort vergessen** (Reset per Mail) und Passwort ändern
- Profil: Name, Firma, Rechnungsadresse; Verwaltung mehrerer **Absenderadressen** (Default wählbar)
- Account löschen (DSGVO-konform, inkl. Datenbereinigung, siehe 6.8)
- Gesperrte Nutzer (`blocked`) können sich einloggen, aber nichts versenden — mit klarem Hinweis

### 6.2 Brieferstellung
**Weg A — PDF-Upload:**
- Drag & Drop Upload, Validierung nach API-Vorgaben: PDF (Ziel: **PDF/A-1b**), **DIN A4 Hochformat**, max. **94 Blatt** (94 Seiten simplex / 188 duplex), max. **20 MB**, Auflösung ≤ 300 dpi; Warnung wenn kein PDF/A-1b (die API konvertiert automatisch, aber mit Risiken bei Fonts/Transparenzen)
- Prüfung von Adressfeld, **Sperrflächen** und **einzeiliger Absenderzeile** gemäß Deutsche-Post-**Briefschablone V3** (fehlende Absenderzeile oder Sperrflächenverletzung = Ablehnung durch die API); falls Adresse nicht sicher passt: Option **„Deckblatt automatisch voranstellen“** (API-Option `coverLetter` oder eigenes Deckblatt per pdf-lib)
- Vorschau mit visuellem Overlay der Adressfenster-Zone

**Weg B — Brief-Editor:**
- Blockbasierter Editor mit Drag & Drop-Anordnung: Briefkopf/Logo (Bild-Upload), Absenderzeile, Adressfeld (automatisch aus Empfängerdaten), Datum, Betreff, Fließtext (Rich Text), Bild-Blöcke, Anlagenvermerk, Fußzeile
- Live-Vorschau; serverseitiges Rendering in dasselbe PDF-Format wie Weg A (ein gemeinsamer Validierungspfad)
- Speichern als wiederverwendbare **Vorlage**

**Serienbrief/Personalisierung:**
- Platzhalter `{{anrede}}`, `{{vorname}}`, `{{nachname}}`, `{{firma}}`, `{{strasse}}` … in Editor-Briefen; beim Versand pro Empfänger personalisiertes PDF
- Muster-PDFs aus `docs/reference/muster/` als Testfixtures verwenden

### 6.3 Empfänger & Leadlisten
- Kontakte-CRUD (Person/Firma), Adressbuch mit Suche
- **Import CSV/XLSX**: Upload → Spalten-Mapping-UI → Validierung (Pflichtfelder, PLZ-/Länderformat) → Fehlerbericht (fehlerhafte Zeilen als CSV exportierbar) → Duplikaterkennung
- Leadlisten: benannte Listen anlegen/verwalten, direkt aus Import erzeugen

### 6.4 Versand
- **Versand-Assistent** (Wizard): Brief wählen → Empfänger (einzeln oder Leadliste) → Optionen (S/W vs. Farbe, Simplex/Duplex, Einschreiben-Varianten sofern API-seitig verfügbar) → **Kostenvorschau** (Seiten × Optionen × Empfängerzahl aus `pricing_table`) → Credit-Prüfung → Bestätigen
- Asynchrone Verarbeitung über Job-Queue: Einzeleinlieferung je Brief, Retry mit Backoff, idempotent (kein Doppelversand)
- Status je Brief nach API-Modell: `1 Angenommen → 2 Geprüft → 3 Druckzentrum → 4 Produziert/Versendet` bzw. `99 Fehler` (final); Zeitleiste in der UI; Status 4 kommt mit 1–2 Tagen Versatz; zusätzlich BZE-Tracking („im Zielgebiet angekommen“, `frankierID`) anzeigen, sofern geliefert
- Status-Sync per **Polling** (Cron-Worker, gedrosselt — die API überwacht die Abfragefrequenz); es gibt keine Provider-Webhooks
- Fehlgeschlagene Briefe (Status 99): **automatische Credit-Erstattung** + Neu-Einlieferung als Retry-Option (ein Rückruf nach Einlieferung ist API-seitig nicht möglich)
- Optionale **Stornofrist** als Produktfeature: Versand über das API-Plugin `UploadManagement` (Terminversand) um z. B. einige Stunden verzögern; solange im Sammelkorb → Stornieren/Vorziehen möglich
- **Probeversand** im Wizard: `testFlag`-Verarbeitung (Prüfung bis Status 2, kein Druck, kostenlos), aufbereitetes PDF via `TestResult` (48 h abrufbar) bzw. Test-Mail, optional mit Sperrflächen-Overlay (`testShowRestrictedArea`) — als „Prüfen“-Schritt vor dem kostenpflichtigen Versand anbieten

### 6.5 E-Post-Integration — E-POSTBUSINESS API (Adapter-Pattern, WICHTIG)
Provider ist die **E-POSTBUSINESS API der Deutschen Post** (technischer Betrieb: DocuGuide). Verbindliche technische Referenz ist die Swagger/OpenAPI-Doku: **https://api.epost.docuguide.com/swagger/index.html** — vor der Implementierung in Phase 5 die OpenAPI-Spezifikation per WebFetch laden und Routen/Schemata daraus verwenden, nicht raten. Technische FAQ: https://api.epost.docuguide.com/generalcontent/EpostApi/Faq

- Interface `LetterProvider` mit: `submitLetter()`, `submitTest()`, `getStatus()`, `listOpenLetters()`, `cancelQueued()`, `releaseQueued()`, `healthCheck()`
- **`MockProvider`**: voll funktionsfähig, simuliert exakt das reale Statusmodell (`1 → 2 → 3 → 4` bzw. `99`, zeitversetzt), erzeugt Fake-`letterID`s. Aktiv wenn `MOCK_MODE=true` **oder** E-Post-Konfiguration fehlt; im UI (Badge) und Admin klar sichtbar.
- **`EpostProvider`** — verifizierte Eckdaten aus der offiziellen Doku:
  - **Auth:** Login mit `vendorID` + EKP (DP-Kundennummer) + Passwort + `secret` über `/api/Login` → **Token, 24 h gültig** (cachen und automatisch erneuern). Erst-Einrichtung eines Zugangs: `/api/Login/smsRequest` (SMS-TAN an hinterlegte Mobilnummer) → `/api/Login/setPassword` → liefert das `secret`.
  - **Zwei Betriebsmodelle** (Geschäftsentscheidung am Phase-1-Checkpoint; der Provider unterstützt beide):
    - a) **Partner-Modell:** jeder Kunde registriert sich bei der Deutschen Post (eigene EKP) und aktiviert seinen Zugang in unserer App per Aktivierungs-Flow (EKP eingeben → SMS-TAN → Passwort setzen → `secret` speichern). Zugangsdaten **verschlüsselt** in `epost_accounts` je Kunde.
    - b) **Eigenversender-Modell:** ein zentraler Account aus ENV, alle Sendungen laufen darüber; `costCenter` je Kunde für die Zuordnung auf der Monatsrechnung.
  - **Einlieferung:** **PDF/A-1b** als base64 + Metadaten (`addressLine1–5`, `zipCode`, `city`, Ländercode, Absenderfelder). **Metadaten müssen exakt mit der aufgedruckten Anschrift übereinstimmen** (v. a. PLZ/Ort/Land) — sonst Ablehnung. Eindeutige Dateinamen; Antwort ist eine eindeutige `letterID`. Wir liefern **einzeln** ein und gruppieren nur logisch per `batchID` (echte Sammel-Einlieferungen müssen bei Fehlern komplett neu eingeliefert werden).
  - **Idempotenz:** `ActivateDuplicateFailsafe=true` setzen (Dublettenprüfung auf identischen PDF-Inhalt, 60-Minuten-Fenster, Fehler E324) — schützt bei Timeouts vor Doppelversand. Zusätzlich `custom1` = unsere `send_job_item.id` mitgeben (`custom1–5` kommen in Statusabfragen zurück).
  - **Kein Rückruf nach Einlieferung.** Stornofenster nur über das Plugin `UploadManagement` (Terminversand/Sammelkorb, max. 31 Tage; `CancelQueued` / `ReleaseQueued`).
  - **Status per Polling — die API bietet KEINE Webhooks:** gedrosselter Cron-Sync (die Abfragefrequenz wird API-seitig überwacht), Abfrage offener Sendungen (Status 1–3), gezielt per `letterID` oder Zeitraum; Status 400 Tage abrufbar. **Nur Status 4 wird von der Post abgerechnet**; Status 99 ist final → neu einliefern.
  - **Einschreiben:** Einwurf | Einschreiben | Rückschein (nicht international); eigene Statusroute (`Letter/Registered`). Pflicht überall: korrekte **einzeilige Absenderzeile** (dient beim Rückschein als Rücksendeadresse).
  - `healthCheck` über `/api/Login/HealthCheck` (ohne Login) im Admin-Systemstatus anzeigen, inkl. Wartungsfenster-Meldungen.
  - **Vercel-Hinweis:** kein IP-Whitelisting bei der Post beauftragen (Vercel hat dynamische Egress-IPs), es sei denn, statische IPs werden eingerichtet.
- Architektur so generisch halten, dass alternative Briefversand-Anbieter (z. B. LetterXpress, Pingen) später als weitere Provider ergänzt werden können.

### 6.6 Geschäftsmodell, Preise & Stripe (vorbereitet)
**Geschäftsmodell: Die Nutzung der Software ist kostenlos — bezahlt wird ausschließlich transaktional pro versendetem Brief.** Keine Abos, keine Grundgebühr. Registrierung → Guthaben aufladen → versenden.

- **Guthaben-Modell (Prepaid)**: Nutzer laden Guthaben auf (Beträge und Mindestbetrag in den Admin-Einstellungen konfigurierbar, Default z. B. 10/25/50/100 €, Mindestbetrag 10 €); jeder Brief bucht seinen Preis vom Guthaben ab. Aus Nutzersicht ist das reines Pay-per-Use — technisch werden Zahlungen aber gebündelt, damit die Stripe-Fixgebühr pro Zahlung nicht die Marge einzelner Briefe frisst.
- **Preisverwaltung im Admin (zentral)**: `pricing_table` führt je Option (Porto-Stufe nach Blattzahl, S/W vs. Farbe, Simplex/Duplex, Zusatzblatt, Einschreiben-Varianten) **Einkaufspreis (EK)** und **Verkaufspreis (VK)** in Cent. Die EK-Werte der Post werden später nachgetragen (Seed vorbereiten, Werte zunächst als Platzhalter mit `TODO`). Marge wird im Admin je Option angezeigt; Warnung, wenn VK < EK.
- **Preis-Snapshot**: Beim Versand werden EK und VK je `send_job_item` festgeschrieben (spätere Preisänderungen verändern keine historischen Jobs); daraus speist sich das Margen-Reporting.
- **Credit-Ledger**: unveränderliche Transaktionen (`topup|spend|refund|admin_adjust`); atomare Buchung beim Versand (DB-Transaktion, kein Negativsaldo, Race-Condition-sicher)
- **Rabattstufen (optional statt Abo-Paketen)**: `plans` wird zu admin-zuweisbaren Preisstufen/Rabattgruppen (Default „Standard“) — z. B. Mengenrabatt für Vielversender. Kein Pflichtbestandteil des Checkouts.
- **Stripe hinter `FEATURE_STRIPE`** (Default `false`), aber vollständig gegen den Stripe-**Testmodus** implementiert:
  - **Checkout für einmalige Guthaben-Aufladungen** (Karte, **SEPA-Lastschrift**, giropay/Sofort je nach Verfügbarkeit — SEPA aktiv anbieten, da Flat-Fee statt Prozentgebühr)
  - **Auto-Aufladung (optional je Nutzer)**: gespeicherte Zahlungsmethode (SetupIntent), off-session PaymentIntent wenn Guthaben unter Schwellwert fällt; SCA-/3DS-Fehlerfälle sauber behandeln (Mail „Aufladung fehlgeschlagen“)
  - Webhook-Handler (`checkout.session.completed`, `payment_intent.succeeded/failed`) mit Signaturprüfung und Idempotenz; Gutschrift **nur** über Webhook, nie über den Redirect
  - **Belege/Rechnungen**: Stripe-Rechnung bzw. Beleg je Aufladung; **Stripe Tax** für USt vorbereiten (Rechnungsadresse Pflicht vor erster Aufladung)
  - Seed-Skript für Stripe-Produkte/Preise; Kauf-UI nur sichtbar, wenn Flag aktiv
- **Spätere Option (nur dokumentieren, nicht bauen)**: nachgelagerte Monats-Sammelabrechnung über Stripe Usage-Based Billing für große Kunden — wegen Zahlungsausfallrisiko (Post wird von uns vorfinanziert) nur mit Limits/Bonität, Eintrag in `docs/IDEAS.md`
- Solange Flag aus: Admin bucht Guthaben manuell (Beta-Betrieb)
- Guthaben-/Transaktionsübersicht für den Nutzer inkl. Belegdownload

### 6.7 Admin-Konsole (`/admin`, nur Rolle `admin`)
- **Dashboard**: KPIs (Nutzer gesamt/neu, Briefe heute/Monat, Guthaben-Umsatz, **Rohertrag** = Σ VK − Σ EK, Fehlerquote, Jobs in Queue)
- **Nutzerverwaltung**: Liste mit Suche/Filter/Sortierung (u. a. nach Preisstufe, Umsatz, Briefvolumen); Detailansicht mit Profil, Preisstufe, Guthaben-Saldo, Briefen, Transaktionen
- Admin-Aktionen: Preisstufe/Rabatt zuordnen, Guthaben buchen (Pflicht-Kommentar), sperren/entsperren, Passwort-Reset auslösen, Account löschen
- **Sendejob-Monitor**: alle Jobs/Items, Filter nach Status, Fehlerdetails, manueller Retry
- **Preisverwaltung**: `pricing_table` mit EK/VK je Option editieren, Margen-Anzeige, Aufladebeträge & Mindestbetrag konfigurieren
- **Feature-Flags & Systemeinstellungen** (inkl. deutlicher Mock-Modus-Anzeige)
- **Audit-Log** aller Admin-Aktionen
- Absicherung doppelt: RLS **und** serverseitige Routen-Guards; erster Admin via Seed (`ADMIN_EMAIL`)

### 6.8 Querschnitt: Mails, Recht, DSGVO, Sicherheit
- Transaktionale Mails: Willkommen, Versandbestätigung, Job abgeschlossen/fehlgeschlagen, Credits niedrig
- Getrennte Bereiche: einfache Marketing-Startseite (Platzhaltertexte ok) vs. App hinter Login
- Rechtsseiten als Platzhalterstruktur: Impressum, Datenschutz, AGB, AVV
- **DSGVO**: Datenexport (JSON) im Profil; Löschkonzept — Brief-PDFs werden `LETTER_RETENTION_DAYS` (Default 30) nach Zustellung automatisch aus dem Storage gelöscht (Cron); Account-Löschung entfernt personenbezogene Daten, Abrechnungsdaten werden anonymisiert aufbewahrt
- **Sicherheit**: RLS auf allen Tabellen; private Storage-Buckets + signierte URLs; Rate Limiting auf Auth/Upload/Versand; serverseitige Zod-Validierung überall; Security-Header; keine Secrets im Client; Adressdaten sind personenbezogen — **niemals im Klartext loggen**
- Strukturierte Logs; Sentry optional via ENV

---

## 7. Phasenplan

### Phase 0 — Setup & Analyse
- `./old_app/` analysieren → `docs/LEGACY_FINDINGS.md`: Featureliste, was übernehmen / verbessern / bewusst weglassen (mit Begründung)
- Repo-Grundstruktur, `CLAUDE.md` (Konventionen, Befehle, Ordnerstruktur)
- Subagenten in `.claude/agents/` anlegen (Markdown mit YAML-Frontmatter: `name`, `description`, restriktive `tools`):
  - `architecture-reviewer` — prüft ADRs, Datenmodell, Skalierbarkeit, Konsistenz (read-only)
  - `security-auditor` — prüft RLS, Auth, Storage-Zugriff, Input-Validierung, Secrets, OWASP-Basics (read-only)
  - `code-reviewer` — Codequalität, Fehlerbehandlung, Typsicherheit, Duplikate (read-only)
  - `ux-reviewer` — Nutzerflüsse, Verständlichkeit deutscher UI-Texte, Fehlerzustände, Responsive; darf Verbesserungsideen für `docs/IDEAS.md` liefern (read-only)
  - `qa-tester` — arbeitet Checklisten ab, denkt in Edge Cases (read-only + Testausführung)
- `docs/PROGRESS.md`, `docs/ASSUMPTIONS.md`, `docs/IDEAS.md` initialisieren
- **DoD:** Dokumente + Subagenten vorhanden, Phasenplan in `PROGRESS.md` übernommen

### Phase 1 — Architektur  ⛔ CHECKPOINT
- ADRs: Datenmodell final, Queue-/Worker-Ansatz, Provider-Adapter, PDF-Pipeline, Ordnerstruktur
- ER-Diagramm (Mermaid) in `docs/ARCHITECTURE.md`
- Review durch `architecture-reviewer`, Findings einarbeiten
- Offene Geschäftsentscheidung für den Checkpoint aufbereiten: **E-Post-Betriebsmodell** (Partner-Modell mit Aktivierung pro Kunde vs. zentraler Eigenversender-Account, siehe 6.5) inkl. Auswirkungen auf Datenmodell, Onboarding-Flow und Abrechnung
- **Dann stoppen:** kompakte Zusammenfassung (Datenmodell, Kernentscheidungen, offene Annahmen) zur Freigabe vorlegen. Nach Freigabe: autonom bis Phase 10.

### Phase 2 — Foundation
- Next.js-Scaffold, Supabase-Migrationen + RLS + Seeds (Admin, Pakete, Preistabelle)
- Auth komplett: Registrierung inkl. Verifizierung, Login, **Passwort vergessen/Reset**, Profil, Absenderadressen
- App-Shell: Navigation, Settings, Fehler-/Ladezustände; Mail-Setup
- Reviews: `security-auditor` (Auth/RLS) + `code-reviewer`; Playwright-E2E: Registrierung → Login → Reset

### Phase 3 — Briefe
- PDF-Upload + Validierung + Vorschau + Deckblatt-Option
- Editor + serverseitige PDF-Generierung + Vorlagen + Platzhalter
- Tests mit Muster-PDFs (sobald vorhanden; sonst eigene Fixtures generieren)

### Phase 4 — Kontakte & Leadlisten
- CRUD, CSV/XLSX-Import mit Mapping-UI, Validierung, Fehlerexport, Duplikaterkennung

### Phase 5 — Versand-Pipeline
- Preisberechnung, Versand-Assistent inkl. Probeversand, Job-Queue + Worker, `MockProvider` voll funktionsfähig, `EpostProvider` vollständig gegen die Swagger-Spezifikation implementiert (Entwicklungsumgebung der API ist kostenlos & ohne physischen Versand nutzbar), Status-Polling-Sync, Credit-Buchung/-Erstattung
- Reviews: `code-reviewer` + `security-auditor` (Credential-Verschlüsselung, Idempotenz, Polling-Drosselung)

### Phase 6 — Guthaben, Preisverwaltung & Stripe-Vorbereitung
- Ledger, EK/VK-Preisverwaltung mit Margen-Anzeige, Preisstufen/Rabatte, Feature-Flag, Stripe-Testmodus (Top-ups + Auto-Aufladung + Belege/Tax), Seed-Skript

### Phase 7 — Admin-Konsole
- Kompletter Umfang aus 6.7 inkl. Audit-Log

### Phase 8 — Härtung
- `security-auditor` über die **gesamte** App; DSGVO-Features (Export, Retention-Cron, Account-Löschung); Performance-Check (Bundle, Queries); Accessibility-Basics
- `ux-reviewer` über alle Kernflüsse; Findings umsetzen

### Phase 9 — QA
- Unit-Tests für Kernlogik (Ledger, Preisberechnung, PDF-Validierung, CSV-Parser, Platzhalter-Rendering)
- Playwright-Suiten: komplette User-Journey (Registrierung → Brief → Leadliste → Versand im Mock → Status) und Admin-Journey
- `qa-tester` arbeitet `docs/QA_CHECKLIST.md` ab; alle Findings fixen

### Phase 10 — Übergabe
- `README.md`: lokales Setup, Supabase-Setup (Projekt anlegen, Migrationen, Auth-Konfiguration inkl. Redirect-URLs), Deployment auf Vercel (ENV-Variablen, Cron-Konfiguration, Domain, Supabase-Verknüpfung)
- `.env.example` vollständig und kommentiert
- `docs/ARCHITECTURE.md` final; `docs/EPOST_INTEGRATION.md` (wo genau API-Daten eingetragen werden + Testplan für den Umstieg Mock → Live); `docs/STRIPE_ACTIVATION.md` (Schritte zur Aktivierung)
- Seeds: Admin + Demo-User + Demo-Daten; Abschlussbericht in `PROGRESS.md` inkl. offener `IDEAS.md`-Punkte

---

## 8. ENV-Variablen (`.env.example` anlegen, jede Variable kommentieren)

```bash
# App
APP_NAME="E-Post Mailer"
APP_URL=
MOCK_MODE=true                # true = MockProvider aktiv, kein echter Briefversand
FEATURE_STRIPE=false          # Stripe-UI & Checkout aktivieren
LETTER_RETENTION_DAYS=30      # Brief-PDFs nach Zustellung automatisch löschen

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=              # für Migrationen

# E-POSTBUSINESS API (Deutsche Post / DocuGuide)
EPOST_BASE_URL=https://api.epost.docuguide.com
EPOST_VENDOR_ID=              # vendorID aus dem API-Nutzervertrag
# Zentraler Account — nur beim Eigenversender-Modell; beim Partner-Modell
# liegen EKP/Passwort/Secret verschlüsselt pro Kunde in der DB (epost_accounts)
EPOST_EKP=
EPOST_PASSWORD=
EPOST_SECRET=
EPOST_CREDENTIALS_KEY=        # Schlüssel zur Verschlüsselung der Zugangsdaten in der DB

# Stripe (Testmodus)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Mail
RESEND_API_KEY=
MAIL_FROM=

# Betrieb
ADMIN_EMAIL=                  # wird beim Seed zum ersten Admin
CRON_SECRET=                  # schützt Worker-/Cron-Endpoints
SENTRY_DSN=                   # optional
```

---

## 9. Was du NICHT tun sollst

- Keine Live-Zahlungen oder Live-Keys aktivieren
- Keinen Legacy-Code blind kopieren — nur geprüft und begründet übernehmen
- Keine zusätzlichen Fremd-Services ohne ENV-Fallback und Eintrag in `ASSUMPTIONS.md`
- Keine Funktionen stillschweigend streichen — Abweichungen vom Umfang immer dokumentieren
- Adress- und Briefdaten niemals im Klartext in Logs, Fehlermeldungen oder Analytics
