# QA_CHECKLIST

> Abzuarbeiten vom `qa-tester`-Subagenten (Phase 9) und vor jedem Release.
> Status je Punkt: PASS / FAIL / BLOCKED (mit Nachweis).
> **Blocked ohne Supabase-Projekt:** alle Punkte, die eine laufende DB brauchen — bis `.env.local` konfiguriert ist.

## 0. DoD-Gates (immer zuerst)

- [ ] `npm run build` grün
- [ ] `npm run lint` grün
- [ ] `npm run typecheck` grün
- [ ] `npm test` grün (Unit)
- [ ] `npx playwright test` grün (E2E; skippt sich ohne Supabase-Konfiguration)

## 1. Auth & Konto

- [ ] Registrierung: Double-Opt-in-Hinweis erscheint; identische Antwort für neue und bereits existierende E-Mail (keine Account-Enumeration)
- [ ] Registrierung: AGB-/Datenschutz-Hinweis mit funktionierenden Links
- [ ] Login mit falschem Passwort → generische deutsche Fehlermeldung
- [ ] Login mit unbestätigter E-Mail → Hinweis auf Bestätigung
- [ ] Passwort vergessen → neutrale Bestätigung („Falls ein Konto …"), unabhängig von Existenz
- [ ] Passwort zurücksetzen über Mail-Link → Weiterleitung nach `/login?reset=success`
- [ ] Passwort ändern verlangt das **aktuelle** Passwort; falsches Passwort → Feldfehler
- [ ] Rate Limiting: 11. Login-Versuch in 5 min → „Zu viele Anfragen"
- [ ] Gesperrter Nutzer (`blocked`) kann sich einloggen, sieht Banner, kann **nicht** versenden/hochladen/aufladen
- [ ] `/app` und `/admin` ohne Session → Redirect nach `/login`
- [ ] Normaler Nutzer auf `/admin` → Redirect nach `/app`
- [ ] Gesperrter **Admin** verliert Konsolenzugriff

## 2. Briefe (PDF-Pipeline)

- [ ] Upload eines gültigen A4-PDFs → „versandbereit", Seitenzahl korrekt
- [ ] Upload eines Nicht-A4-PDFs (z. B. 595.32 pt breit) → **harter Fehler**, kein Brief angelegt
- [ ] Upload > 20 MB → Fehler, kein Storage-Objekt
- [ ] Upload > 188 Seiten → Fehler; 95–188 Seiten → Warnung „nur beidseitig"
- [ ] Upload eines verschlüsselten PDFs → Fehler mit Hinweis auf Passwortschutz
- [ ] Upload eines PDFs mit Inhalt in der DVF-Sperrzone → harter Fehler
- [ ] Upload ohne erkennbare Empfängeranschrift → Warnung + Deckblatt-Empfehlung
- [ ] Deckblatt-Schalter ändert die Blattzahl (Preisstufe kann kippen)
- [ ] Vorschau rendert; Zonen-Overlay lässt sich ein-/ausblenden
- [ ] Editor: Bausteine hinzufügen/verschieben/löschen
- [ ] Editor: Platzhalter-Chip fügt an der Cursorposition ein (nicht am Ende); zweites Einfügen ebenfalls
- [ ] Editor: unbekannter Platzhalter `{{quatsch}}` → Warnung
- [ ] Editor: sehr langer Text → mehrseitiges PDF, kein Fehler
- [ ] Editor: Speichern läuft durch dieselbe Validierung (Proberendering)
- [ ] Vorlage speichern und in neuem Brief laden

## 3. Kontakte & Import

- [ ] Kontakt anlegen ohne Nachname und ohne Firma → Fehler
- [ ] PLZ „1011" bei Land DE → Fehler; „1011 AB" bei NL → OK
- [ ] Suche mit Komma („Mustermann, Max") liefert Ergebnisse (kein 400)
- [ ] CSV mit Semikolon (deutsches Excel) wird erkannt
- [ ] CSV mit BOM → Header korrekt
- [ ] CSV mit ausschließlich fehlerhaften Zeilen → 0 importiert, Fehlerbericht herunterladbar
- [ ] Doppelter Import derselben Datei → 0 neu, alle als Duplikate
- [ ] Duplikate innerhalb einer Datei werden übersprungen
- [ ] Fehlerexport-CSV: Zelle `=cmd|…` wird mit `'` entschärft (keine Formel in Excel)
- [ ] Import ohne Mapping für Straße/PLZ/Ort → Hinweis, Button deaktiviert
- [ ] Leadliste aus Import wird erzeugt und enthält die Kontakte
- [ ] XLSX-Datei mit Umlauten importiert korrekt

## 4. Versand & Preise

- [ ] Kostenvorschau zeigt **nur VK** (keine EK-Werte im Netzwerk-Response)
- [ ] Preisstufen: 1 Blatt = Standard, 2–4 = Kompakt, 5–10 = Groß, 11+ = Groß + Zusatzblätter
- [ ] Duplex halbiert die Blattzahl (aufgerundet)
- [ ] Rabatt der Preisstufe wirkt nur auf VK
- [ ] Guthaben reicht nicht → Button deaktiviert, Fehlbetrag genannt, **Auflade-Button** vorhanden
- [ ] Versand mit exakt passendem Guthaben → funktioniert, Saldo 0
- [ ] Doppelklick auf „Kostenpflichtig versenden" → **nur ein Job**, nur eine Belastung
- [ ] Probeversand ist kostenlos (keine Ledger-Buchung)
- [ ] Job mit 0 Empfängern nicht möglich
- [ ] Stornofrist: Job mit Verzögerung → Storno erstattet, keine Einlieferung
- [ ] Storno eines bereits eingelieferten Briefs erstattet diesen **nicht**
- [ ] Mock-Provider: Status läuft 1→2→3→4 zeitversetzt; Zeitleiste zeigt Ereignisse
- [ ] Mock: Empfänger mit „FAIL" im Ort → Status 99, **automatische Erstattung**, Job „Mit Fehlern abgeschlossen"
- [ ] Fehlgeschlagenes Item: Erstattung genau einmal (kein doppelter Refund bei erneutem Sync)
- [ ] Serienbrief: jeder Empfänger erhält ein individuell aufgelöstes PDF

## 5. Guthaben & Stripe (Testmodus)

- [ ] `FEATURE_STRIPE=false` → Beta-Hinweis, kein Checkout-Button
- [ ] `FEATURE_STRIPE=true`: Aufladung unter Mindestbetrag → Fehler
- [ ] Aufladung über Höchstbetrag → Fehler
- [ ] Aufladung ohne vollständige Rechnungsadresse → Hinweis auf Profil
- [ ] Gutschrift erfolgt **nur** über den Webhook, nie über den Redirect
- [ ] Webhook mit falscher Signatur → 400
- [ ] Webhook-Replay desselben `event_id` (bereits `processed`) → 200, keine zweite Gutschrift
- [ ] Webhook-Replay eines zuvor **fehlgeschlagenen** Events → Verarbeitung läuft erneut
- [ ] Aufladung gibt `on_hold_funds`-Briefe wieder frei
- [ ] Live-Key (`sk_live_…`) → Anwendung verweigert den Start des Stripe-Clients

## 6. Admin-Konsole

- [ ] Dashboard-KPIs plausibel; Rohertrag = Σ (VK − EK) der versendeten Briefe
- [ ] Ledger-Integritätsalarm erscheint bei künstlicher Abweichung
- [ ] Guthaben buchen ohne Kommentar → nicht möglich
- [ ] Negative Buchung unter 0 → Fehler „würde Guthaben negativ machen"
- [ ] Sperren des eigenen Kontos nicht möglich
- [ ] Preisverwaltung: VK < EK bei aktiver Option → nur mit ausdrücklicher Bestätigung
- [ ] Einstellungen: unbekannter Key oder falscher Typ → Fehler
- [ ] Retry eines fehlgeschlagenen Briefs: **genau einmal** ausführbar (Button verschwindet), belastet erneut, legt Klon an
- [ ] Retry bei zu wenig Guthaben → Fehler, **kein** Klon, keine Belastung
- [ ] Jede Admin-Mutation erscheint im Audit-Log

## 7. DSGVO & Sicherheit

- [ ] Datenexport liefert JSON mit Profil, Kontakten, Briefen, Jobs, Ledger — **ohne EK-Werte**
- [ ] Kontolöschung verlangt Passwort **und** „LÖSCHEN"
- [ ] Nach Löschung: Login unmöglich, PII entfernt, Ledger-Summen unverändert, Storage leer
- [ ] Nach Löschung: `recipient_snapshot`, `error_message`, `status_events.details` anonymisiert
- [ ] Admin-Löschung meldet Anzahl bereits eingelieferter Briefe
- [ ] Direkter PostgREST-Zugriff auf `send_job_items.ek_cents` als eingeloggter Nutzer → **verweigert**
- [ ] Direkter Zugriff auf fremde Zeilen (contacts, letters, jobs) → leer
- [ ] `/api/cron/*` ohne `CRON_SECRET` → 401
- [ ] CSP-Header enthält Nonce, kein `'unsafe-inline'` in `script-src`; App funktioniert
- [ ] Keine Adress-/Briefdaten in Server-Logs

## 8. Robustheit / Edge Cases

- [ ] Umlaute und ß in Empfängeradressen erscheinen korrekt im PDF
- [ ] Empfänger in AT/CH → Ländername in Großbuchstaben als letzte Adresszeile
- [ ] Empfänger in nicht unterstütztem Land → Versand schlägt kontrolliert fehl (kein W203 beim Provider)
- [ ] Adressblock mit Firma + Person + Zusatz + Ausland → max. 6 Zeilen
- [ ] Sehr langer Name/Firma wird im PDF gekürzt statt zu überlaufen
- [ ] Parallele Versände, die dasselbe Guthaben verbrauchen → einer schlägt mit `insufficient_funds` fehl, kein Negativsaldo
- [ ] Worker doppelt gestartet → keine Doppeleinlieferung (SKIP LOCKED + CAS-Claim)
- [ ] Queue-Job mit abgelaufenem Lock wird zurückgesetzt
- [ ] Import mit 10.000 Zeilen bleibt im Zeitbudget

## 9. Responsive & Accessibility

- [ ] Alle Kernseiten bei 375 px bedienbar (Navigation über Menü-Sheet)
- [ ] Tabellen scrollen horizontal statt die Seite zu sprengen
- [ ] Fokus-Zustände sichtbar; Formulare per Tastatur absendbar
- [ ] Alle Formularfelder haben Labels (nicht nur Placeholder)
- [ ] Icons `aria-hidden`, Buttons ohne Text haben `aria-label`
