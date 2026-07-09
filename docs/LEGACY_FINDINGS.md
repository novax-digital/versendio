# LEGACY_FINDINGS — Analyse `old_app/`

> Analyse der alten Lovable-Codebase (TanStack Start + React 19 + Supabase, SSR auf Cloudflare Workers).
> Zweck: Was übernehmen / verbessern / bewusst weglassen. Kein Code wird ungeprüft kopiert.

## 1. Überblick

- **Stack alt:** TanStack Start 1.167 (file-based Router), React 19, Supabase (Postgres/Auth/Storage, keine Edge Functions), shadcn/ui + Tailwind v4, `pdf-lib`, `papaparse`, Zod, React Query. Kleine, kohärente Codebase (~15 tragende Dateien).
- **Wichtigster Befund:** Die App enthält eine **echte, funktionierende E-POSTBUSINESS-API-Integration** (kein Mock) inkl. Onboarding per SMS-TAN — aber **kein Guthaben-/Abrechnungssystem** (0 Treffer für credit/billing/stripe/preis) und keine skalierbare Versand-Pipeline.

## 2. Routen/Features der alten App

| Route | Funktion | Zustand |
|---|---|---|
| `/login` | Anmelden/Registrieren (Tabs), E-Mail+Passwort | ✅ funktional; keine E-Mail-Verifizierung, kein Passwort-Reset |
| `/app` | Dashboard: 3 Statistik-Karten, letzte 5 Mailings, Setup-Hinweis | ✅ |
| `/app/recipients` (+ `$listId`) | Empfängerlisten-CRUD, CSV-Upload, Empfänger-Formular (Zod) | ✅; kein Edit, keine Duplikaterkennung, keine Pagination/Suche |
| `/app/mailings` (+ `new`, `$id`) | Mailing-Wizard (PDF-Upload ODER Editor), Versand, Statusabruf, Test-PDF-Download | ⚠️ funktional, aber synchroner Versand-Loop |
| `/app/settings/epost` | Admin-only E-POST-Einrichtung (Absenderzeile, SMS-TAN → Passwort → secret) | ✅ gut gemachter 3-Schritt-Wizard |

Nicht vorhanden: Admin-Konsole (außer E-POST-Setup), Billing/Guthaben, Profil-/Kontoseite, Rechtsseiten, Marketing-Seite.

## 3. Datenmodell alt (1 Migration)

`user_roles` (app_role admin|user; SECURITY DEFINER `has_role()`), `profiles` (Trigger: **erster User wird automatisch Admin**), `epost_config` (**Single-Row** id=1: vendor_id, ekp, mobile, password, secret, sender_line — RLS ohne Client-Policies, Status nur via RPC mit Booleans), `recipient_lists`, `recipients` (inkl. `extra JSONB`, Land-Default DE), `mailings` (status draft|sending|sent|failed, content_type pdf|editor, test_mode default true), `mailing_recipients` (**unveränderlicher Versand-Snapshot** mit `epost_letter_id`). RLS überall (own-row). Storage-Bucket `mailing-pdfs` privat mit Per-User-Ordner-Policy.

⚠️ Echte `vendor_id` (`N3349506538H`) und `ekp` (`5290173143`) sind **im Migrations-SQL hardcodiert** — im Neubau gehören diese in ENV/verschlüsselte Config, nie ins Repo.

## 4. E-POST-Integration (verifiziertes Verhalten — wertvollste Referenz)

Basis `https://api.epost.docuguide.com`, ein zentraler Account für alle Nutzer (Eigenversender-Modell de facto):

- **Login:** `POST /api/Login {vendorID, ekp, secret, password}` → `{token}` (JWT, ~23 h im Modul-Cache).
- **Onboarding:** `POST /api/Login/smsRequest {vendorID, ekp}` → TAN; `POST /api/Login/setPassword {vendorID, ekp, newPassword, smsCode}` → liefert `secret`.
- **Einlieferung:** `POST /api/Letter` mit Array von `{fileName, data(base64), isColor, isDuplex, batchID, testFlag, testShowRestrictedArea, coverLetter, addressLine1–3, zipCode, city, country, senderAdressLineComplete}` → `letterID`.
- **Status:** `GET /api/Letter/{letterID}` → `{statusID (1|2|3|4|99), statusDetails, printUploadDate, printFeedbackDate, frankierID, errorList[]}`.
- **Test-PDF:** `GET /api/Letter/TestResult?letterID=…` → base64-Proof (48 h).
- **Hart erarbeitetes Domänenwissen (unbedingt erhalten):**
  - `country` bei DE-Sendungen **weglassen** (Metadaten müssen exakt zur gedruckten Anschrift passen — Fehler **W203**).
  - A4-MediaBox exakt `[595.276, 841.89]` — `595.28` wird mit **W208** abgelehnt.
  - Keine eigenen Falzmarken drucken; Druck im 2-mm-Rand → Fehler **E302**.
  - `batchID` alt = Unix-Sekunden (kollisionsanfällig) → im Neubau echte eindeutige IDs.

## 5. PDF-Handling alt

- **Generierung** (Editor-Weg) via `pdf-lib`: Schablone-V3-Geometrie als Konstanten (Adressblock x=23 mm, Absenderzeile 8 pt bei y=45 mm, Empfänger max. 6 Zeilen 9 pt ab y=69 mm, Betreff bei 112 mm, Word-Wrap via `widthOfTextAtSize`). Deckt sich mit unserer Transkription in `docs/reference/epost/schablone-v3.md`.
- **Upload-Validierung: fehlt komplett** — hochgeladene PDFs gehen ungeprüft an die Post (nur UI-Warnbox). Größte Lücke des alten PDF-Pfads.
- Assets übernommen: `docs/reference/epost/epost-schablone-v3.pdf` (Original-Schablone) und `epost-schablone-page1.jpg` (Preview-Overlay) aus `old_app/public/`.

## 6. Übernehmen / Verbessern / Weglassen

| Bereich | Urteil | Begründung |
|---|---|---|
| E-POST-API-Client (Endpunkte, Auth, Statusmodell, Fehlercode-Wissen) | **Übernehmen (refactored)** | Verifiziert echt; als typisierter Provider hinter `LetterProvider`-Interface neu verpacken |
| Schablonen-Geometrie + PDF-Generator-Kern | **Übernehmen** | Hart erarbeitete Konstanten (W208/W203/E302) — Basis unserer PDF-Pipeline |
| `postal-code.ts` (länderbewusste PLZ-Validierung, DE/AT/CH/NL/PL/GB…) | **Übernehmen** | Self-contained, korrekt, deutsche Fehlhinweise |
| `parseCsvToRecipients` (tolerantes Header-Mapping DE+EN) | **Übernehmen (erweitert)** | Gute Basis; um XLSX, Mapping-UI, Fehlerexport, Duplikaterkennung erweitern |
| Empfänger-Snapshot bei Versand (`mailing_recipients`) | **Übernehmen** | Richtiges Muster → `send_job_items` |
| Test-Modus (testFlag + TestResult-PDF) | **Übernehmen** | Wird unser „Probeversand“-Schritt im Wizard |
| E-POST-Setup-Wizard (SMS-TAN-Flow) + `LetterPreview` (mm→% Overlay) | **Übernehmen (UX-Idee)** | Klarer Flow, gute deutsche Texte |
| Deutsche UI-Texte / Empty States | **Übernehmen** | Professionell, DIN-5008-Terminologie korrekt |
| Auth-Grundgerüst | **Verbessern** | + E-Mail-Verifizierung, Passwort-Reset, Admin via `ADMIN_EMAIL`-Seed statt „erster User = Admin“ |
| PDF-Upload-Pfad | **Verbessern** | Echte Validierung (A4, Seitenzahl, Adresszonen, Größe) ergänzen |
| Versand-/Status-Pipeline | **Neu bauen** | Synchroner Loop im Request: Timeout bei großen Listen, hängende `sending`-Mailings, keine Idempotenz → Job-Queue + Cron-Polling |
| Guthaben/Billing/Preise | **Neu bauen** | Existiert nicht |
| Admin-Konsole | **Neu bauen** | Nur E-POST-Setup vorhanden |
| Storage-Cleanup | **Neu bauen** | Alt: gelöschte Mailings hinterlassen Orphan-PDFs → Retention-Cron |
| TanStack Start / Cloudflare-Hosting | **Weglassen** | Neubau ist Next.js auf Vercel (Masterprompt-Vorgabe) |
| Client-seitige Business-Logik (Insert/Upload direkt via supabase-js) | **Weglassen** | Validierung + Credit-Buchung müssen serverseitig laufen |
| Hardcodierte vendor_id/ekp in Migration | **Weglassen** | Gehört in ENV / verschlüsselte Config |
| `recharts` (ungenutzt), Lovable-Plumbing | **Weglassen** | Toter Ballast |

## 7. Schlüsseldateien in `old_app/` (zum Nachschlagen)

- Integration: `src/lib/epost.server.ts`, `src/lib/epost.functions.ts`, `src/lib/mailings.functions.ts`
- PDF: `src/lib/pdf.server.ts` · PLZ: `src/lib/postal-code.ts`
- CSV: `src/routes/_authenticated/app.recipients.index.tsx`
- Schema: `supabase/migrations/20260513080502_*.sql`
