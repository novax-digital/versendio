# ASSUMPTIONS & DECISIONS

> Eigenständig getroffene Entscheidungen mit Begründung. Architektur-Grundsatzentscheidungen zusätzlich als ADR in `docs/adr/`.

## A-001 — Legacy-Ordner heißt `old_app/`, nicht `legacy/`
Der Masterprompt referenziert `./legacy/`, im Repo liegt die alte Codebase unter `./old_app/` (per P.S. im Masterprompt bestätigt). Alle Referenzen wurden auf `old_app/` angepasst. `old_app/` ist via `.gitignore` vom neuen Repo ausgeschlossen (enthält eine eigene `.env` mit Secrets und ~200k Zeilen Lockfile — reine Referenz, kein Bestandteil des Produkts).

## A-002 — EK-Preise aus vorliegender Preisliste übernommen
Der Masterprompt sagt „EK-Werte der Post werden später nachgetragen“. Die per Anhang bereitgestellte Preisliste (gültig ab 01.01.2025, Kunde Novax Digital GmbH) enthält die nationalen EK-Preise bereits → sie werden direkt als Seed-Werte verwendet (siehe `docs/reference/epost/preisliste-api-2025.md`). Nur Einschreiben-Zuschläge und International bleiben TODO-Platzhalter.

## A-003 — Porto-Stufen nach Blattzahl
Preisliste staffelt nach Blatt (Standard inkl. 1 Blatt / Kompakt inkl. 4 / Groß inkl. 10, danach je weiteres Blatt). Blattzahl = Seiten bei Simplex, ⌈Seiten/2⌉ bei Duplex. Gewichtsgrenzen (20/50/500 g) werden bei Standard-80-g-Papier durch die Blattgrenzen abgedeckt; wir rechnen daher blattbasiert.

## A-005 — `old_app/src/styles.css` durch Tooling verändert
`shadcn init` hat beim Setup versehentlich die CSS-Datei der Legacy-App als Ziel erkannt und deren Farbwerte auf das Neutral-Theme überschrieben (Original-Brandfarben nicht wiederherstellbar). Folgenlos: `old_app/` wird hier nie gebaut und ist gitignored; alle relevanten Legacy-Erkenntnisse sind in `docs/LEGACY_FINDINGS.md` gesichert. `components.json` wurde auf `src/app/globals.css` korrigiert.

## A-013 — Produktname: Versendio, Hauptdomain versendio.de (2026-07-10)
Der Arbeitstitel „E-Post Mailer" wurde vom Product Owner durch **Versendio** ersetzt; Hauptdomain ist **versendio.de**. Umgesetzt: `de.common.appName`, `APP_NAME`-Default in `env.ts`, `package.json`-Name, Stripe-Seed-Metadaten (`app: versendio` — unkritisch, da noch kein Stripe-Produkt existierte), GDPR-Export-Formatkennung, `.env.example`- und README-Beispiele (Site-/Redirect-URLs, `MAIL_FROM`). Der Repo-Ordnername `E-Post-Mailer` und historische Dokumente (MASTERPROMPT, ADRs, PROGRESS-Verlauf) bleiben unverändert — sie sind Arbeitsstand, kein Kundenkontakt. `APP_URL=https://versendio.de` wird beim Deployment gesetzt.

## A-010 — Zwei getrennte Adress-Builder (Druck vs. Provider)
Der QA-Durchlauf deckte auf, dass `addressLine1–5` der E-POST-API laut Swagger v2.6.1 **nur** Name/Firma, Straße und Adresszusatz tragen („Empfängerzeile 1 (z. B. Name,Firma)"); PLZ, Ort und Land werden ausschließlich über die separaten Felder `zipCode`/`city`/`country` übergeben. Beides zusammen hätte auf dem echten Brief die Ortsangabe doppelt gedruckt.
Daher zwei Funktionen in `src/lib/shared/address.ts`:
- `buildRecipientAddressLines()` → **gedruckter** Adressblock (Deckblatt, Editor-Rendering): inkl. PLZ/Ort-Zeile und Ländername.
- `buildProviderAddressLines()` → **API-Payload**: ohne PLZ/Ort/Land, max. 5 Zeilen; `addressLine5` nur bei DE.
Zusätzlich aus der Spec übernommen: Auslandsempfänger ohne Postleitzahl erhalten drei Leerzeichen im Feld `zipCode`. Unit-Tests sichern beide Varianten gegeneinander ab.

## A-011 — Maximal 2.000 Empfänger je Sendung
Eine Leadliste kann bis zu 10.000 Kontakte enthalten, ein Sendejob wurde jedoch stillschweigend auf 2.000 gekürzt (QA-Finding F1: Nutzer zahlt für 2.000 und glaubt, die ganze Liste sei versendet). Statt der Kürzung gilt nun eine harte, in `MAX_RECIPIENTS_PER_JOB` zentral definierte Obergrenze mit klarer Fehlermeldung („Bitte teilen Sie die Liste auf."). Größere Mailings über mehrere Jobs sind bewusst gewollt — sie halten Jobsumme, Kostenvorschau und Queue-Batching überschaubar.

## A-012 — Navigations-Buttons sind Links, keine Buttons
`Button render={<Link/>}` ließ Base UI dem `<a>` die Rolle `button` geben — Screenreader hätten Navigation als Schaltfläche angesagt. Alle Navigations-Schaltflächen nutzen daher `ButtonLink` (`src/components/ui-ext/button-link.tsx`): echtes `<a>` mit Button-Styling über `buttonVariants`.

## A-008 — Stornofrist über Queue-Hold statt UploadManagement-Plugin
Die Swagger-Spec (v2.6.1) zeigt: das UploadManagement-Plugin arbeitet nur **tagesgenau** (dueDate/dueDays/dueDayofWeek als Stichtag). Der Masterprompt wünscht eine Verzögerung „um einige Stunden". Umsetzung daher: `scheduled_release_at` hält die `submit_item`-Jobs in **unserer Queue** (`run_at` = Freigabezeitpunkt) — bis dahin ist Storno kostenlos (Job-Abbruch + `job_cancel_rest`-Refund, PDFs haben unser System nie verlassen) und Vorziehen trivial (`run_at = now()`). Stundengenau, keine Plugin-Abhängigkeit. `cancelQueued`/`releaseQueued` sind im Provider trotzdem implementiert (Interface-Vollständigkeit, spätere Plugin-Nutzung möglich).

## A-009 — Verifizierte API-Constraints (Swagger v2.6.1, geladen 2026-07-09)
- `costCenter`: max. 8 Zeichen, nur [0-9a-zA-Z] → `profiles.cost_center` = 8 Hex-Zeichen der User-ID.
- `batchID`: int32 → `send_jobs.provider_batch_id` (Zufalls-31-Bit je Job); unsere `batch_id` (uuid) bleibt interne Gruppierung.
- `registeredLetter`-Werte: `'Einwurf Einschreiben'` | `'Einschreiben'` | `'Einschreiben Rückschein'`.
- `country`: deutscher Ländername in GROSSBUCHSTABEN (z. B. ÖSTERREICH), **weglassen bei Inland** — deckt sich mit `buildRecipientAddressLines`.
- `fileName`: 5–200 Zeichen, eindeutig, keine Sonderzeichen.
- Crash-Recovery-Lookup existiert: `GET /api/Letter/Custom1` + `GET /api/Letter/Batch`; Sammelabfragen: `GET /api/Letter/Open`, `POST /api/Letter/StatusQuery`, `GET /api/Letter/Date`.

## A-007 — Editor Phase 3: Bild-/Logo-Bausteine im Datenmodell und Renderer, UI teilweise vertagt
Der Masterprompt §6.2 nennt für den Editor Briefkopf/Logo, Bild-Blöcke, Anlagenvermerk und Fußzeile. Umgesetzt in Phase 3: Datenmodell (`image`-Block, `logoStoragePath`) und **serverseitiges Rendering** dieser Elemente sowie der Asset-Upload (`uploadAssetAction`, `assets`-Bucket) sind vollständig vorhanden. Die **Editor-UI** exponiert vorerst Betreff-, Text- und Abstands-Bausteine; das Hinzufügen von Bild-/Logo-Bausteinen über die Oberfläche und dedizierte Anlagen-/Fußzeilen-Bausteine folgen als Ausbau (IDEAS I-004). Damit ist der Serienbrief-Kernfluss (Text + Platzhalter → validiertes A4-PDF) end-to-end nutzbar; keine stillschweigende Streichung, nur UI-Priorisierung.

## A-006 — Gesperrte Nutzer dürfen einloggen (Spec vor Security-Finding)
Das Phase-2-Security-Review empfahl, gesperrte Nutzer (`status=blocked`) hart auszusperren. MASTERPROMPT §6.1 verlangt jedoch ausdrücklich: „Gesperrte Nutzer können sich einloggen, aber nichts versenden — mit klarem Hinweis.“ Umsetzung daher: Login und App-Zugang bleiben offen, ein Banner weist auf die Sperre hin; die **Durchsetzung liegt auf den sensiblen Aktionen** (Upload, Versand, Aufladung) via `blockedActionError()` in `src/lib/server/auth-context.ts`. Diese Aktionen entstehen ab Phase 3/5 — der Guard ist bereitgestellt und wird dort verdrahtet.

## A-004 — Schablone V3: Sicherheitsabstand im Editor-Rendering
Die Schablone warnt davor, Zonen bis zum Rand auszureizen (Brief kann im Umschlag verrutschen). Unser Editor-Rendering setzt Adress-/Absenderzeilen mit ≥ 2 mm Innenabstand zur Zonengrenze.

## A-008 — Brandbook v1.0 umgesetzt; Dark Mode abgeleitet
Das Versendio-Brandbook (Juli 2026) definiert Farben (Kurierblau #2C4BE8, Tiefblau #1C33AF, Tinte #101828, Himmel-Tint #EEF1FE, Status Erfolg/Warnung/Fehler), Typografie (Poppins für Überschriften, Inter für UI) und die Asset-Ablage unter `public/brand/`. Umgesetzt als shadcn-Token in `globals.css` (inkl. neuer Tokens `primary-hover`, `success`, `warning`, `ink`). Das Brandbook definiert **keinen Dark Mode** — die `.dark`-Palette ist abgeleitet (Tinte als Grundfläche, aufgehelltes Kurierblau für Kontrast) und bei Bedarf per Brandbook-Update zu ersetzen. Exakte Pixel-Größen der Typo-Hierarchie (H1 28/H2 20/Body 15) wurden als Richtwerte behandelt, nicht hart erzwungen.

## A-009 — KI-Entwurf: Missbrauchsschutz ohne Micro-Debit, Anthropic als Auftragsverarbeiter
Die KI-Brieferstellung (`generateLetterDraftAction`) kostet uns Tokens, auch wenn der Brief nie versendet wird. Schutzstufen: (1) Env-Flag `FEATURE_AI_DRAFTS` + Admin-Kill-Switch `ai_drafts_enabled` (Limit 0 wirkt ebenso), (2) gesperrte Konten ausgeschlossen, (3) **Guthaben-Gate**: Guthaben ≥ günstigster Briefpreis (VK, kind=tier) — bewusst nur eine Heuristik ohne Abbuchung; die TOCTOU-Lücke zwischen Saldo-Lesen und Generierung ist akzeptiert, (4) Minuten-Limit (`ai:<user>`, 5/min) und Tagesquote (`ai_daily:<user>`, Limit aus `app_settings`) **atomar** über den bestehenden `check_rate_limit`-RPC — beide fail-closed, weil hier externe Kosten geschützt werden (Umkehrung des sonstigen Fail-open-Trade-offs), (5) Eingabe-Caps und Zod-validierte Modellausgabe; unbekannte `{{token}}` werden entfernt. `ai_draft_log` ist reine Service-Role-Telemetrie (keine Client-Policies, nur Längen/Tokenzahlen, nie Inhalte — auch nicht in Logs), wird bei Anonymisierung gelöscht und im GDPR-Export ausgegeben. Anthropic ist damit Unterauftragsverarbeiter → Hinweis im Dialog; **vor Go-live in Datenschutzerklärung/AVV aufnehmen**. Provider-Interface (`LetterDraftProvider`) ist die Naht für die spätere Novax-Plattform. Micro-Debit pro Entwurf: bewusst vertagt (IDEAS I-012). Zwei akzeptierte Nebenwirkungen: (a) der Tagesquoten-Slot wird beim Prüfen verbraucht, auch wenn die Generierung anschließend fehlschlägt (Anti-Abuse: sonst wären "fehlgeschlagene" Aufrufe kostenlose Retries); (b) Vorlagen aus v1-Briefen tragen `legacyLayout` weiter — bewusst, damit eine Vorlage exakt so aussieht wie gespeichert.

## A-010 — Builder v2: Legacy-Metriken eingefroren, Canvas ist Schätzung, Renderer erzwingt Zonen
Der visuelle Brief-Editor (Dokumentmodell v2) ändert Typografie-Metriken (Zeilenhöhe 1,35 × Schriftgrad statt fix 4,6 mm). Damit **bestehende v1-Briefe nicht still umbrechen und sich neu bepreisen** (Blattzahl → Porto-Stufe!), setzt die v1→v2-Migration `theme.legacyLayout=true`: exakt 4,6 mm Zeilenvorschub bei 11 pt, Betreff in Grundgröße — per Differentialtest gepinnt. Einzige bewusste Abweichung: ein überlaufender **End-Abstandshalter** erzeugt keine leere (bezahlte) Seite mehr. Die Canvas-Seitenschätzung ist blockgranular und als „ca." ausgewiesen; verbindlich bleibt die Server-Validierung beim Speichern („Versand-Vorschau"). Zonen-Sicherheit (12-mm-Streifen, Ränder, DVF) wird **im Renderer erzwungen** (Wrap + x-Clamp aller Textblöcke, Bild-Skalierung auf Seitenkapazität), nicht im Validator — analyze-zones sieht nur Text. Glyph-Abdeckung wird beim Speichern geprüft (Warnung, kein Fehler). Schriften: 3 OFL-Familien (Lato, Poppins, PT Serif) als statische TTFs in `public/fonts` — identische Dateien für Browser-Canvas (@font-face) und PDF (fontkit, Subset); `outputFileTracingIncludes` bindet sie in alle rendernden Serverless-Bundles ein, bei Fehlen fällt der Renderer auf Helvetica zurück (loggt, wirft nie im Worker).

## A-014 — B2B-Preismodell: alles netto, feste 19 % USt. an der Zahlungsgrenze (2026-07-13)
Alle Beträge in der Anwendung (VK-Preise, Guthaben, Ledger) sind **netto**. Die Umsatzsteuer
entsteht ausschließlich beim Guthabenkauf: Der Stripe-Checkout hängt eine feste exklusive
Tax Rate (19 %, DE, find-or-create per Metadata-Marker, `getVatTaxRateId`) an das Line-Item —
der Kunde zahlt netto + USt., die Stripe-Rechnung weist die Steuer aus, gutgeschrieben wird
der Nettobetrag (`metadata.amount_cents`). Die Auto-Aufladung zieht netto × 1,19 ein und bucht
netto; ein itemisierter USt.-Ausweis fehlt dort noch (IDEAS I-016). Bewusste Vereinfachungen:
(a) fester Steuersatz statt Stripe Tax — **EU-Reverse-Charge/OSS wird nicht abgebildet**
(IDEAS I-017); bei EU-Auslandskunden vor Vertragsabschluss klären. (b) Bereits gekauftes
Guthaben (vor der Umstellung) wurde ohne USt.-Aufschlag bezahlt — Bestandsguthaben bleibt
unverändert netto stehen.

## A-015 — Flow-Aufnahme bei Kontaktanlage/Import: Opt-in über Listen-Mitgliedschaft (2026-07-21)
Beim manuellen Anlegen eines Kontakts und beim CSV-Import kann der Nutzer die neuen Kontakte optional in **aktive Flows** aufnehmen (Mehrfachauswahl, nur aktive Flows sichtbar). Nicht-offensichtliche Festlegungen:
- **Mechanismus = Listen-Mitgliedschaft, kein Enrollment-Bypass.** „In Flow aufnehmen" schreibt die Kontakte als Einträge in die **Ziel-Liste des Flows**; der bestehende `AFTER INSERT`-Trigger `enroll_contact_in_flows` erzeugt die Enrollment mit Config-Snapshot. Das ist zwingend, weil der Scheduler (`scheduler.ts`) zum Feuerzeitpunkt die Listen-Mitgliedschaft erneut prüft und andernfalls `canceled: contact_left_list` setzt — eine „Enrollment ohne Liste" würde nie versenden.
- **Idempotent** über den Unique-Index `(list_id, contact_id)` (`upsert … ignoreDuplicates`). Ein bereits gelisteter Kontakt wird nicht doppelt aufgenommen; entsprechend feuert der Trigger für ihn nicht erneut (konsistent mit „Aktivieren macht keinen Backfill").
- **Auswahl gruppiert nach Liste (ehrliches Modell):** Weil der Trigger listenbasiert **alle** aktiven Flows einer Liste aufnimmt, bietet der Picker eine Auswahl **pro Liste** an (beschriftet mit den Flow-Namen darauf), nicht pro Flow — eine echte Teilmenge einer geteilten Liste ist technisch nicht wählbar. Im Regelfall (auto-erzeugte „Flow: …"-Liste, 1:1) sieht das wie „ein Haken pro Flow" aus. Die Rückmeldung („in N Flows aufgenommen") zählt die **tatsächlich betroffenen** aktiven Flows (alle Flows der gewählten Listen), damit die kostenrelevante Zahl stimmt. Server-Inserts sind Best-Effort (ein fehlgeschlagener Batch verbirgt keine bereits erfolgten Aufnahmen); eine Überauswahl beim Import bricht den Import nie ab (serverseitig auf 50 gekappt).
- **Nur beim Anlegen, nicht beim Bearbeiten.** Die Flow-Aufnahme ist eine Entscheidung zum Erstellungszeitpunkt; das Bearbeiten eines Kontakts bietet sie nicht an. Der Import nimmt neu importierte **und** als Duplikat erkannte bestehende Kontakte auf (dieselbe Menge wie die optionale Import-Liste).
- **Gesperrte Nutzer:** Enrollment wird übersprungen (`blockedActionError`), da es einen kostenpflichtigen Versand terminiert; der Import ist für gesperrte Konten ohnehin komplett gesperrt.
- **Scoping:** `loadActiveFlows` und der Enrollment-Helper filtern **explizit** `user_id`, weil die `flows`-RLS für Admins verbreitert ist; die `lead_list_entries`-`with check`-Policy verlangt zusätzlich Eigentum an Liste **und** Kontakt.

## A-016 — E-Mail-Benachrichtigungen: Opt-out-Modell, zentrales Gate, Digest statt Einzelmails (2026-07-21)
Vier neue Mail-Kategorien (Aufladebestätigung, Sendungsabschluss, Zustellstatus-Updates, Flow-Aktivität) mit Schaltern unter Einstellungen → Benachrichtigungen. Nicht-offensichtliche Festlegungen:
- **Opt-out statt Opt-in:** vier typisierte Boolean-Spalten auf `profiles` (`notify_*`, Default `true`) — House-Pattern (`welcome_sent_at`-Präzedenz), schreibbar über die bestehende `profiles_update_own`-Policy, kein GDPR-/RLS-Neubau.
- **Ein Durchsetzungspunkt:** `processSendEmail` prüft die Prefs zentral (`templateAllowed`), nicht die Enqueue-Stellen — deckt auch Retries und bereits eingereihte Jobs nach einer Pref-Änderung ab. Fällt **nur** beim Undefined-Column-Fehler 42703 (Deploy vor Migration) auf „senden" zurück; jeder andere Lesefehler wirft und wird über die Queue erneut versucht, damit Opt-outs nie durch transiente Fehler umgangen werden.
- **Immer gesendet** (bewusst nicht abschaltbar): Willkommen, Konto-Löschung, Auto-Aufladung fehlgeschlagen, Briefe zurückgestellt (Guthaben fehlt) — konto-/handlungskritisch. Unbekannte Templates senden ebenfalls (abschaltbar nur durch explizites Mapping).
- **Digest statt Einzelmails:** E-POST-Statuswechsel werden pro Sendung und Sync-Lauf (15 min) aggregiert (`job_status_update`); im selben Lauf abgeschlossene Jobs bekommen nur die Abschluss-Mail (kein Doppel). Test-Sendungen erhalten keine Status-Digests (geklemmte Status). Flow-Aktivität wird pro (Nutzer, Flow) und Tick gebündelt (`flow_summary`); nur der **erste** Guthaben-Hold zählt (erkannt über das vorherige `last_error`, nicht über `attempts` — der Zähler ist reason-übergreifend), dazu terminale Eskalationen. Enthält eine Flow-Zusammenfassung Guthaben-Holds oder endgültige Fehlschläge, wird sie **auch bei abgeschaltetem Flow-Toggle** zugestellt (handlungskritisch — hält das „wichtige Hinweise immer"-Versprechen der Einstellungsseite). Digest-Zählungen erfolgen nur, wenn der zugehörige DB-Write nachweislich persistiert wurde (CAS/affected-rows) — ein transient fehlgeschlagener Write oder ein paralleler Lauf mailt nie doppelt.
- **Aufladebestätigung idempotent über das Ledger:** `bookTopup` meldet über den Unique-Index-Konflikt, ob das Event erstmals gebucht wurde — nur dann wird gemailt (Webhook-Replays mailen nie doppelt). Gilt für manuelle, Auto-(Invoice)- und Legacy-Auto-Aufladung; Bonus wird mit ausgewiesen.
- **At-most-once, best-effort:** Mail-Versand blockiert nie Geld-/Statuspfade (fire-and-forget Enqueues, `sendMail` wirft nie); eine verlorene Mail wird akzeptiert, eine doppelte nicht.
- ⚠️ **Operator-Schritt:** Migration `20260721100000_notification_prefs.sql` muss auf der Datenbank angewendet werden (`npx supabase db push` oder SQL-Editor). Der Code läuft dank Fallback auch vorher, aber die Schalter speichern erst danach.

## A-017 — Gutscheincodes: Gratis-Guthaben über den Ledger, einmal pro Nutzer (2026-07-21)
Admin erstellt Gutscheincodes (fester Betrag), die Kunden im Guthaben-Bereich einlösen. Nicht-offensichtliche Festlegungen:
- **Buchung über den einzigen Geld-Eintrittspunkt:** Einlösen bucht `book_credit(type='topup', reference_type='voucher', reference_id='<voucher>:<user>')` — echtes Gratis-Guthaben ohne Kauf/USt., analog zum Auflade-Bonus. Der Ledger-Unique-Index `(type, reference_type, reference_id)` erzwingt damit **eine Einlösung pro (Gutschein, Nutzer)** als letzte Sicherung; zusätzlich `voucher_redemptions unique(voucher_id, user_id)`.
- **Atomar & ohne Oversell:** die SECURITY-DEFINER-RPC `redeem_voucher` validiert, bucht, zählt hoch — alles in einer Transaktion, serialisiert per `FOR UPDATE` auf der Gutschein-Zeile, sodass `max_redemptions` unter Nebenläufigkeit nicht überschritten wird. Stabile Fehlercodes (`voucher_not_found|inactive|expired|exhausted|already_redeemed`) werden serverseitig ins Deutsche gemappt.
- **Einlösegrenzen:** `max_redemptions` = Gesamtzahl (null = unbegrenzt), **einmal pro Nutzer**; `valid_until` optional (null = unbegrenzt, gespeichert als Tagesende UTC); `is_active`-Schalter zum Sperren. Anzeige `redemption_count / max` im Admin.
- **Codes:** case-insensitive (Unique-Index auf `upper(code)`), Auto-Generierung aus mehrdeutigkeitsfreiem Alphabet (ohne O/0/I/1/L) via `crypto.randomInt`; manuelle Codes `[A-Z0-9-]{4,40}`. Einlöse-Action **rate-limitet** (10/h je Nutzer+IP), da der Code das einzige Geheimnis ist.
- **Kein Stripe nötig:** funktioniert auch bei deaktiviertem Zahlungs-Feature (reines Promo-Guthaben). Frisches Guthaben stößt geparkte „Guthaben fehlt"-Briefe wieder an.
- **Löschschutz:** eingelöste Gutscheine sind FK-geschützt (`on delete restrict`) → nur deaktivierbar, nicht löschbar; ungenutzte löschbar.
- **RLS:** `vouchers` nur für Admins lesbar (Codes sind Geheimnisse), alle Schreibzugriffe über Service-Role/RPC; `voucher_redemptions` eigene Zeilen lesbar.
- ⚠️ **Operator-Schritt:** Migration `20260721110000_vouchers.sql` wurde bereits angewendet (RPC transaktional gegen Prod verifiziert, ohne echte Buchung).

## A-018 — SSO-Login: Google + Microsoft über Supabase OAuth (2026-07-21)
Login/Registrierung zusätzlich per Google (Workspace) und Microsoft (Supabase-Provider-Key `azure` — M365/Azure AD), passend zum B2B-Zielmarkt. Nicht-offensichtliche Festlegungen:
- **Bestehende Pfade tragen alles:** Der PKCE-Callback (`/auth/callback`) tauscht auch OAuth-Codes (inkl. Welcome-Mail-One-Shot über `welcome_sent_at` — feuert beim ersten SSO-Login genau einmal); der `handle_new_user`-Trigger legt das Profil an. Migration `20260721130000` coalesced dafür den Anzeigenamen `display_name → full_name → name` (OAuth liefert `full_name`/`name`). MFA-Step-up (`enforceMfaStepUp`) greift session-basiert unverändert.
- **Start-Action** `signInWithProviderAction`: Zod-Enum `google|azure`, per-IP-Rate-Limit (Login-Scope), `skipBrowserRedirect` + `redirect(data.url)`; Azure mit explizitem `email`-Scope (sonst fehlt der E-Mail-Claim). SSO-Signup = SSO-Login (ein Flow).
- **Identity-Linking:** Supabase-Default — gleiche, vom Provider verifizierte E-Mail wird automatisch mit einem bestehenden Konto verknüpft.
- **`company` bleibt bei SSO leer** — wird spätestens mit der Pflicht-Rechnungsadresse vor der ersten Aufladung erfasst.
- ⚠️ **Operator-Schritte:** (1) Google Cloud Console: OAuth-Client (Web), Redirect `https://<project-ref>.supabase.co/auth/v1/callback` → Client-ID/Secret in Supabase → Auth → Providers → Google. (2) Azure-Portal: App-Registrierung (empfohlen multi-tenant „common"), gleiche Callback-URI → Supabase → Providers → Azure. (3) Redirect-URLs (`https://app.versendio.de/auth/callback`, localhost) prüfen. (4) Datenschutzerklärung um Google/Microsoft ergänzen. Der volle Roundtrip ist erst nach (1)/(2) testbar.

## A-019 — Whitelabel-SaaS: Endkunden ohne Login, Job-Attribution, VK-only-Abrechnung (2026-07-21)
Admin-vergebener `is_whitelabel`-Status (geschützte Profilspalte, in `protect_profile_columns` aufgenommen — Selbstvergabe unmöglich) schaltet Menüpunkt „Whitelabel", Endkunden-Verwaltung und erweiterte API frei. Nicht-offensichtliche Festlegungen:
- **Endkunden (`wl_customers`) sind reine Datenobjekte** — kein Login, keine Auth-Identität; Guthaben/Debits laufen unverändert über das Konto des Whitelabel-Kunden.
- **Attribution auf Job-Ebene** (`send_jobs.wl_customer_id`), geschrieben **nach** `confirm_send_job` per Post-RPC-Update (Flows-Präzedenz mit `send_job_id`) — die Geld-RPC bleibt unangetastet. Idempotente Replays schreiben denselben Wert erneut. Zuordnung nur per API (`customerId` bei `letters/send`); Assistent-Dropdown bewusst vertagt (IDEAS I-030).
- **Abrechnungssemantik** (`wl_customer_usage`, eine Quelle für UI + API): nur Items mit Status `sent` zählen (nur das stellt DP in Rechnung, ADR-0007), Testversand ausgeschlossen, erstattete Fehlschläge separat ausgewiesen; Zeitraumfilter auf `submitted_at`; **VK-only** — EK bleibt Betriebsgeheimnis.
- **Kundennummer (`external_ref`)** unique je Besitzer → idempotente API-Anlage (409 liefert den Bestand). **Löschen nur ohne Sendungen** (FK `restrict`, Abrechnungshistorie), sonst deaktivieren.
- **GDPR:** Endkunden-Namen/-Mails sind Dritt-PII → `delete_user_wl_customers` (nullt Attribution, löscht Zeilen) im Lösch-Orchestrator (api_keys-Pattern).
- Transaktional gegen die DB verifiziert: Anlage/Attribution/Usage (1 Brief = 115 Cent), Monats-/Zukunftsfilter, Unique-`external_ref`, FK-Restrict, GDPR-Helper.
