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
