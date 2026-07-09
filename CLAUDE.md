# CLAUDE.md — E-Post-Mailer

SaaS for sending physical letters via Deutsche Post E-POSTBUSINESS API. Prepaid credit billing, no subscriptions. Target: Vercel + Supabase.

**Session resume:** read `MASTERPROMPT.md` (binding requirements) → `docs/PROGRESS.md` (current phase/state) → `docs/ASSUMPTIONS.md`, then continue at the next open item. One mandatory checkpoint after Phase 1 (architecture approval); otherwise work autonomously.

## Commands

(Available after Phase 2 scaffold.)

```bash
npm run dev          # Next.js dev server
npm run build        # production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest unit tests
npx playwright test  # E2E tests
```

Definition of Done per phase: build + lint + typecheck + relevant tests green, review-subagent findings fixed, `docs/PROGRESS.md` updated, committed.

## Structure

```
MASTERPROMPT.md          # binding requirements — the contract
CLAUDE.md                # this file
docs/                    # PROGRESS, ASSUMPTIONS, IDEAS, ARCHITECTURE, LEGACY_FINDINGS
docs/adr/                # architecture decision records
docs/reference/epost/    # Preisliste (EK prices!), Schablone V3 geometry, original PDFs
docs/reference/muster/   # sample letter PDFs (test fixtures)
old_app/                 # legacy Lovable app — REFERENCE ONLY, gitignored, never import from it
.claude/agents/          # review subagents (architecture/security/code/ux/qa)
src/                     # Next.js app (from Phase 2)
supabase/migrations/     # SQL migrations, RLS on every table
```

## Conventions

- **Language:** UI texts German (Sie-Form), centralized in one strings module (i18n-ready). Code, comments, commits in English.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`); commit after each completed work package.
- **TypeScript:** `strict`; no `any`; Zod validation on every server entry point, types inferred from schemas.
- **Money:** always integer cents; credit ledger is append-only; debits/refunds only server-side in DB transactions; EK+VK snapshot per sent item.
- **Security:** RLS on all tables; private storage buckets + signed URLs; service-role key server-only; never log address/letter data in cleartext; `CRON_SECRET` on worker endpoints.
- **Serverless:** workers are cron-triggered route handlers, small idempotent batches, retry with backoff; no reliance on module state (in-memory caches must have a rebuild path).
- **Providers:** all letter dispatch behind `LetterProvider` interface; `MockProvider` when `MOCK_MODE=true` or E-Post config missing (visible badge in UI/admin).
- **Decisions:** non-obvious choices → `docs/ASSUMPTIONS.md`; bigger deferred ideas → `docs/IDEAS.md`; architecture-level → ADR in `docs/adr/`.

## Domain knowledge (hard-won, do not rediscover)

- E-Post API: base `https://api.epost.docuguide.com`, login via `vendorID+EKP+password+secret` → 24h JWT; **no webhooks** — status via throttled polling; statuses `1→2→3→4` (4 = billed by DP) or `99` final error.
- PDF: A4 MediaBox must be exactly `[595.276, 841.89]` (595.28 → error W208); for DE letters omit `country` in metadata (mismatch → W203); nothing printed in 2mm margin / 12mm left strip (→ E302); no own fold marks.
- Address zones (Schablone V3, mm from top-left): sender line (1 line, 8pt) at x23 y45 w85 h5.5; DVF blocked zone y52–68 (must be empty); recipient block (max 6 lines, 9pt) y69–90; see `docs/reference/epost/schablone-v3.md`.
- Postage tiers by **sheet** count (not pages): 1 sheet Standard / ≤4 Kompakt / ≤10 Groß / +extra per sheet; EK prices in `docs/reference/epost/preisliste-api-2025.md`.
- Idempotent submission: `ActivateDuplicateFailsafe=true` (E324 on duplicate within 60min) + `custom1` = our `send_job_item.id`.
- Legacy findings & reusable code pointers: `docs/LEGACY_FINDINGS.md` (PLZ validation, CSV header mapping, PDF generator geometry in `old_app/src/lib/`).
