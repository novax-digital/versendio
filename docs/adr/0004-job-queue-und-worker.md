# ADR-0004: Job-Queue & Worker auf Vercel

**Status:** akzeptiert · **Datum:** 2026-07-09

## Kontext
Vercel Serverless: keine Langläufer, kein persistenter Prozess. Die Legacy-App versendete synchron im Request (Timeout bei großen Listen, hängende Jobs — LEGACY_FINDINGS §7.2). E-Post bietet keine Webhooks → Status-Polling nötig, API-seitig frequenzüberwacht.

## Entscheidung
1. **Generische DB-Queue** `job_queue` (ADR-0002) für alle Hintergrundarbeit: `submit_item`, `sync_status`, `send_email`, `cleanup_storage`, `auto_topup`, `release_queued`.
2. **Claim per `FOR UPDATE SKIP LOCKED`** über eine Postgres-Funktion `claim_jobs(p_types, p_limit, p_worker_id)`: setzt `running`, `locked_at`, `locked_by` atomar. Mehrere parallele Worker-Invocations kollidieren nicht.
3. **Worker = Route Handler** unter `/api/cron/*`, geschützt durch `CRON_SECRET` (Authorization-Header). `vercel.json`-Crons:
   - `/api/cron/queue` — **jede Minute**: claimt kleine Batches (Default 10 Jobs, konfigurierbar in `app_settings`), verarbeitet mit Zeitbudget (~50 s bei 60 s maxDuration), gibt Rest zurück.
   - `/api/cron/status-sync` — **alle 15 Minuten** (konfigurierbar): plant `sync_status`-Jobs für Items in Status 1–3, **gedrosselt** (max. N Abfragen/Lauf, bevorzugt `listOpenLetters`-Sammelabfrage statt Einzel-GETs, sofern die API das hergibt — Phase 5 verifiziert gegen Swagger).
   - `/api/cron/maintenance` — **täglich**: Retention-Löschung (`LETTER_RETENTION_DAYS`), Orphan-Storage-Cleanup, Ledger-Abgleich, `dead`-Job-Report.
4. **Retry/Backoff:** exponentiell mit Jitter (1 min, 5 min, 25 min…), `max_attempts` Default 5, danach `dead`. Bei `submit_item` zusätzlich fachlich: Item → `failed` + Refund-Job, wenn endgültig.
5. **Idempotenz je Job-Typ:**
   - `submit_item` — Doppelversand ist der teuerste Fehler, daher dreifach abgesichert:
     1. Status-Guard: nur Items in `pending|submitting` werden verarbeitet; `first_submit_attempt_at` wird vor dem ersten POST gesetzt.
     2. Provider-seitig `ActivateDuplicateFailsafe=true` (Dubletten-Fenster **60 min**) + `custom1 = item.id`. Damit Retries dieses Fenster nie verlassen: Submit-Retries mit kurzem Backoff (1/5/15 min) und `max_attempts=3` — Gesamtspanne < 60 min ab `first_submit_attempt_at`.
     3. **Recovery eines in `submitting` hängenden Items (Crash nach POST): niemals blind erneut einliefern.** Zuerst Pflicht-Reconciliation beim Provider (Lookup per `custom1`/`batchID` — die konkrete Abfragefähigkeit ist **hartes Phase-5-Verifikationsgate** gegen die Swagger-Spec). Liefert der Lookup eine `letterID` → Item auf `submitted` nachziehen. Ist kein Lookup möglich **und** das 60-min-Fenster abgelaufen → Item `failed` + Refund + Admin-Flag „manuell prüfen“ statt Risiko-Resubmit.
   - `sync_status`/`send_email`: natürlicherweise idempotent bzw. mit Unique-Referenz.
6. **Job-Erzeugung:** Versand-Bestätigung legt Job + Items + `submit_item`-Queue-Jobs in **einer Transaktion** mit der Spend-Buchung an (alles oder nichts).
7. **Stuck-Job-Recovery:** `running` mit `locked_at` älter als Timeout → vom nächsten Queue-Lauf zurück auf `pending` (attempts+1).

## Verworfene Alternativen
- Externe Queue (Inngest, QStash, Upstash): zusätzlicher kostenpflichtiger Fremd-Service ohne Not (Masterprompt §4/§9); DB-Queue reicht für die Volumina (Briefpost, kein Echtzeitbedarf).
- Supabase Edge Functions + pg_cron: zweite Runtime/Deploy-Ziel; Vercel Cron ist das verbindliche Ziel.
- Versand direkt in der Server Action: exakt der Legacy-Fehler.

## Konsequenzen
- Skaliert über Batch-Größe und Cron-Frequenz; 1.000er-Mailing braucht ~2 h bei Default-Einstellungen (10 Items/min) — akzeptabel für Briefpost, im Admin einstellbar.
- Alle Worker sind beliebig oft aufrufbar (idempotent) — manueller „Jetzt verarbeiten“-Knopf im Admin ist trivial.
