# Versendio

SaaS-Plattform zum Versand physischer Briefe über die **E-POSTBUSINESS API der Deutschen Post** — erreichbar unter [versendio.de](https://versendio.de).
Brief per PDF hochladen oder im Editor erstellen, Empfänger einzeln oder als Leadliste importieren,
Versand mit Statusverfolgung. Die Nutzung ist kostenlos — abgerechnet wird rein transaktional pro
Brief über ein Prepaid-Guthaben.

**Stack:** Next.js 16 (App Router, React 19, TypeScript strict) · Supabase (Auth, Postgres, Storage)
· Tailwind CSS + shadcn/ui · pdf-lib + pdf.js · Stripe (Testmodus) · Vercel

---

## Schnellstart (lokal)

```bash
# 1. Abhängigkeiten
npm install

# 2. Umgebungsvariablen
cp .env.example .env.local
#    → mindestens NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#      SUPABASE_SERVICE_ROLE_KEY eintragen (siehe „Supabase einrichten")

# 3. Datenbank aufsetzen (siehe unten), dann
npm run seed:admin        # macht ADMIN_EMAIL zum ersten Administrator

# 4. Entwicklungsserver
npm run dev               # http://localhost:3000
```

Ohne E-Post-Zugangsdaten läuft die Anwendung automatisch im **Mock-Modus**: der komplette
Versandpfad (Queue, Statusmodell 1→2→3→4/99, Erstattungen) funktioniert, es geht nur kein echter
Brief raus. Ein Badge in der Oberfläche und der Admin-Systemstatus zeigen das an.

### Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver |
| `npm run build` | Produktions-Build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit-Tests (Vitest) |
| `npm run test:e2e` | E2E-Tests (Playwright) |
| `npm run seed:admin` | `ADMIN_EMAIL` zum Administrator machen |
| `npm run seed:demo` | Demo-Daten für ein Testkonto anlegen |
| `npm run seed:stripe` | Stripe-Produkt anlegen (nur Testmodus) |

---

## Supabase einrichten

### 1. Projekt anlegen

1. Auf [supabase.com](https://supabase.com) ein Projekt erstellen (Region: EU, z. B. Frankfurt — DSGVO).
2. Unter **Settings → API** kopieren:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (**niemals in den Client!**)
3. Unter **Settings → Database** den Connection-String kopieren → `SUPABASE_DB_URL`.

### 2. Migrationen und Seeds einspielen

Mit der Supabase CLI (empfohlen):

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push          # spielt supabase/migrations/*.sql der Reihe nach ein
psql "$SUPABASE_DB_URL" -f supabase/seed.sql   # Default-Plan, Preistabelle, Settings
```

Alternativ ohne CLI: die Dateien aus `supabase/migrations/` **in Dateinamen-Reihenfolge** im
SQL-Editor des Dashboards ausführen, danach `supabase/seed.sql`.

Die Migrationen legen an: 21 Tabellen mit **Row Level Security auf allen**, die Geldfunktion
`book_credit` (Row-Lock, append-only Ledger), die Job-Queue, Storage-Buckets mit Per-User-Policies,
die Versand-RPCs und die DSGVO-Löschfunktion.

### 3. Auth konfigurieren

Unter **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:3000` (lokal) bzw. `https://versendio.de` (Produktion)
- **Redirect URLs** (beide Umgebungen eintragen):
  - `http://localhost:3000/auth/callback`
  - `https://versendio.de/auth/callback`

Unter **Authentication → Providers → Email**: „Confirm email" **aktivieren** (Double-Opt-in ist
Teil des Registrierungsflusses).

Optional unter **Authentication → Emails**: die Vorlagen auf Deutsch umstellen.

### 4. Ersten Admin anlegen

```bash
# ADMIN_EMAIL in .env.local setzen, dann:
npm run seed:admin
```

Das Skript sucht den Account über die Auth-Admin-API (nicht über die Profil-E-Mail), legt ihn bei
Bedarf an und setzt die Rolle `admin`. Passwort anschließend über „Passwort vergessen" vergeben.

---

## Deployment auf Vercel

### 1. Projekt verbinden

Repository in Vercel importieren. Framework-Preset **Next.js** wird automatisch erkannt.

### 2. Umgebungsvariablen setzen

Alle Variablen aus `.env.example` in **Settings → Environment Variables** eintragen. Pflicht für
Produktion:

| Variable | Hinweis |
|---|---|
| `APP_URL` | **In Produktion zwingend.** Auth-Links werden daraus gebaut; ohne sie schlägt der Start der Auth-Aktionen bewusst fehl (Schutz vor Host-Header-Injection). |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | öffentlich, RLS-geschützt |
| `SUPABASE_SERVICE_ROLE_KEY` | geheim, nur serverseitig |
| `CRON_SECRET` | schützt `/api/cron/*` — ohne ihn antworten die Worker mit 401. `openssl rand -hex 32` |
| `EPOST_CREDENTIALS_KEY` | 32 Byte base64, verschlüsselt Provider-Credentials und Token. `openssl rand -base64 32` |
| `MOCK_MODE` | `true` lassen, bis der E-Post-Live-Test bestanden ist (siehe `docs/EPOST_INTEGRATION.md`) |
| `FEATURE_STRIPE` | `false` lassen, bis Stripe aktiviert wird (siehe `docs/STRIPE_ACTIVATION.md`) |

### 3. Cron-Jobs

`vercel.json` ist Teil des Repositories und richtet drei Cron-Jobs ein:

| Pfad | Takt | Aufgabe |
|---|---|---|
| `/api/cron/queue` | jede Minute | Job-Queue abarbeiten (Einlieferung, Mails, Cleanup, Auto-Aufladung) |
| `/api/cron/status-sync` | alle 15 Minuten | gedrosseltes Status-Polling beim Provider |
| `/api/cron/maintenance` | täglich 03:30 | Retention, zurückgestellte Briefe, Erstattungs-Nachbuchung, Ledger-Prüfung |

Vercel sendet automatisch `Authorization: Bearer $CRON_SECRET`. Cron-Jobs erfordern mindestens den
Pro-Plan.

### 4. Domain und Supabase verknüpfen

1. Domain `versendio.de` in Vercel hinzufügen.
2. `APP_URL=https://versendio.de` setzen.
3. Die Domain in Supabase unter **Site URL** und **Redirect URLs** eintragen.
4. Redeploy.

> **Kein IP-Whitelisting bei der Deutschen Post beauftragen** — Vercel hat dynamische Egress-IPs.
> Nur mit dedizierten statischen IPs möglich.

---

## Projektstruktur

```
MASTERPROMPT.md          Verbindliche Anforderungen (Arbeitsgrundlage)
CLAUDE.md                Konventionen, Befehle, Domänenwissen
docs/
  PROGRESS.md            Projektfortschritt je Phase
  ARCHITECTURE.md        Systemübersicht, ER-Diagramm, Versand-Pipeline
  adr/                   Architekturentscheidungen (0001–0009)
  ASSUMPTIONS.md         Eigenständige Entscheidungen mit Begründung
  IDEAS.md               Backlog größerer Verbesserungen
  QA_CHECKLIST.md        Release-Checkliste
  EPOST_INTEGRATION.md   Umstieg Mock → Live
  STRIPE_ACTIVATION.md   Stripe scharfschalten
  reference/epost/       Preisliste (EK), Schablone V3
src/
  app/(marketing)/       Öffentliche Seiten, Rechtsseiten
  app/(auth)/            Login, Registrierung, Passwort
  app/(app)/app/         Eingeloggter Bereich
  app/admin/             Admin-Konsole
  app/api/cron/          Worker-Endpoints
  app/api/webhooks/      Stripe-Webhook
  components/            UI (shadcn) + Feature-Komponenten
  lib/server/            Nur serverseitig (Provider, Queue, PDF, Krypto, Geld)
  lib/shared/            Isomorph (Zod-Schemas, Preise, Adressen, Schablone)
  lib/i18n/de.ts         Alle deutschen UI-Texte
supabase/migrations/     SQL, RLS in derselben Migration wie die Tabelle
tests/unit | tests/e2e   Vitest | Playwright
old_app/                 Alte Lovable-Codebase — nur Referenz, gitignored
```

## Sicherheits-Grundsätze

- **RLS auf allen Tabellen.** Sensible Tabellen (Preise, Queue, Webhooks, Audit, Credentials) haben
  bewusst *keine* Client-Policies und sind nur mit dem Service-Role-Key erreichbar.
- **Einkaufspreise sind Geschäftsgeheimnis:** `ek_cents` und `pricing_snapshot` sind per
  Spalten-Privileg für die Rolle `authenticated` gesperrt. Die Kostenvorschau liefert nur VK.
- **Geld bewegt sich ausschließlich über `book_credit`** (Row-Lock, kein Negativsaldo,
  append-only Ledger, Idempotenz über ein disjunktes Referenz-Vokabular).
- **Gutschriften nur über den Stripe-Webhook**, nie über den Redirect.
- **Kein Doppelversand:** Wizard-Idempotenz (`client_token`), atomarer Item-Claim,
  Provider-Dublettenschutz (`ActivateDuplicateFailsafe` + `custom1`), Reconciliation statt blindem
  Resubmit nach einem Crash.
- **CSP mit Per-Request-Nonce** (`strict-dynamic`, kein `'unsafe-inline'` für Skripte).
- Adress- und Briefdaten erscheinen niemals im Klartext in Logs, Fehlermeldungen oder Mails.

## Weiterführend

- Live-Schaltung des Briefversands: [`docs/EPOST_INTEGRATION.md`](docs/EPOST_INTEGRATION.md)
- Stripe aktivieren: [`docs/STRIPE_ACTIVATION.md`](docs/STRIPE_ACTIVATION.md)
- Architektur und Datenmodell: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Vor dem Go-live: [`docs/QA_CHECKLIST.md`](docs/QA_CHECKLIST.md)
