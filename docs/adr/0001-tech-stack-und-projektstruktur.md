# ADR-0001: Tech-Stack & Projektstruktur

**Status:** akzeptiert · **Datum:** 2026-07-09

## Kontext
Der Masterprompt gibt den Stack verbindlich vor (Next.js App Router, Supabase, Tailwind + shadcn/ui, Vercel). Zu entscheiden bleiben Versionen, Ordnerstruktur und Abgrenzung Server/Client.

## Entscheidung
- **Next.js 15 (App Router, React 19), TypeScript `strict`**, `src/`-Layout. Server Components als Default; Client Components nur für Interaktivität (Editor, Wizard, Formulare).
- **Mutationen über Server Actions** (Zod-validiert); **Route Handlers** nur für: Cron-Worker (`/api/cron/*`), Stripe-Webhook (`/api/webhooks/stripe`), Datei-Downloads/Signed-URL-Vermittlung.
- **Supabase** mit `@supabase/ssr` (Cookie-basierte Session). Drei Client-Varianten: Browser-Client (anon), Server-Client (anon + User-Session, RLS greift), Admin-Client (service-role, nur in `src/lib/server/`).
- **Struktur:**

```
src/
  app/
    (marketing)/            # öffentliche Startseite, Rechtsseiten
    (auth)/                 # login, registrieren, passwort-reset
    (app)/                  # eingeloggter Bereich: dashboard, briefe, kontakte,
                            # leadlisten, versand, guthaben, einstellungen
    admin/                  # Admin-Konsole (Guard: Rolle admin)
    api/
      cron/                 # Worker-Endpoints (CRON_SECRET)
      webhooks/stripe/
  components/
    ui/                     # shadcn/ui
    letter-editor/          # Editor-Blöcke
    ...                     # Feature-Komponenten
  lib/
    server/                 # NUR serverseitig (service-role, Krypto, Provider)
      providers/            # LetterProvider: mock.ts, epost.ts
      queue/                # Job-Queue-Logik
      pdf/                  # Validierung, Rendering, Deckblatt
      credits/              # Ledger-Buchungen
      pricing/              # Preisberechnung
    shared/                 # isomorph: Zod-Schemas, Typen, Utils, PLZ-Validierung
    i18n/de.ts              # zentrale deutsche UI-Texte
supabase/
  migrations/               # SQL, RLS in derselben Migration wie die Tabelle
  seed/                     # Seeds: Admin, Preistabelle, Settings, Demo-Daten
tests/
  unit/                     # Vitest
  e2e/                      # Playwright
```

- Server-only-Module werden mit `import "server-only"` abgesichert.
- **Vercel:** `vercel.json` definiert Cron-Jobs; Node.js-Runtime (nicht Edge) für alle Routen mit pdf-lib/Krypto.

## Konsequenzen
- Ein gemeinsamer Codepfad für Validierung (Zod-Schemas in `lib/shared`, serverseitig verbindlich).
- Business-Logik (Credits, Preise, Versand) ist ausschließlich über `lib/server/` erreichbar — nie im Client (Gegenteil der Legacy-App, siehe LEGACY_FINDINGS §7.8).
