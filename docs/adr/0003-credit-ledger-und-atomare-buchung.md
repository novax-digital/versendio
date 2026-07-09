# ADR-0003: Credit-Ledger & atomare Buchung

**Status:** akzeptiert · **Datum:** 2026-07-09

## Kontext
Guthaben ist echtes Geld. Anforderungen: unveränderliches Ledger, kein Negativsaldo, race-sicher bei parallelen Versänden, automatische Erstattung bei Status 99, Gutschrift nur über Stripe-Webhook.

## Entscheidung
1. **Alle Beträge in Integer-Cent.** Ledger `credit_transactions` ist append-only: keine UPDATE/DELETE-Policies + BEFORE-Trigger, der UPDATE/DELETE für jedermann (auch service-role) ablehnt. Korrekturen sind neue Buchungen (`admin_adjust` mit Pflicht-Kommentar).
2. **Eine einzige Buchungsfunktion** in Postgres (SECURITY DEFINER, nur service-role ausführbar):
   `book_credit(p_user_id, p_type, p_amount_cents, p_reference_type, p_reference_id, p_comment, p_created_by)`
   - `SELECT … FROM profiles WHERE id = p_user_id FOR UPDATE` (Row-Lock serialisiert alle Buchungen eines Users),
   - prüft `balance + amount >= 0`, sonst Exception `insufficient_funds`,
   - schreibt Ledger-Zeile mit `balance_after_cents` und aktualisiert `profiles.credit_balance_cents` in derselben Transaktion.
3. **Idempotenz:** partieller Unique-Index auf `(type, reference_type, reference_id)` für `type IN ('spend','refund','topup')` — jede fachliche Buchung existiert höchstens einmal. **Die `reference_type`-Werte sind ein festes, disjunktes Vokabular** (jede Buchungsursache hat ihren eigenen Typ, damit unterschiedliche Buchungen zum selben Objekt nie kollidieren):
   - `job_confirm` (spend, ref = send_job.id) — Jobsumme bei Bestätigung,
   - `item_render_adjust` (spend **oder** refund, ref = send_job_item.id) — Differenz Schätzung ↔ tatsächliches Rendering (ADR-0006 §4),
   - `item_failed` (refund, ref = send_job_item.id) — Erstattung bei Status 99 / endgültigem Einlieferungsfehler,
   - `item_canceled` (refund, ref = send_job_item.id) — Storno aus dem Sammelkorb,
   - `job_cancel_rest` (refund, ref = send_job.id) — Resterstattung nicht eingelieferter Items bei Job-Abbruch,
   - `stripe_event` (topup, ref = event_id).
   Ein Item kann so korrekt **sowohl** eine Render-Anpassung **als auch** später eine Fehler-Erstattung erhalten (verschiedene reference_types). `admin_adjust` ist vom Index ausgenommen. Unit-Test-Pflicht: „Item heruntergebucht → danach Status 99“ ergibt zwei unabhängige Ledger-Zeilen.
4. **Buchungszeitpunkte:**
   - **Spend:** beim Bestätigen des Versand-Jobs **eine Buchung über die Jobsumme** (`job_confirm`). Begründung: Nutzer bestätigt einen Gesamtpreis; ein Lock statt n Locks bei 1.000 Empfängern. **Wizard-Idempotenz:** die Bestätigung trägt einen client-generierten Token; `send_jobs.client_token` ist unique je User — Doppelklick/Netzwerk-Retry/Action-Replay liefert den bereits angelegten Job zurück statt doppelt zu buchen.
   - **Render-Anpassung** (`item_render_adjust`): siehe ADR-0006 §4 inkl. definierter Semantik bei unzureichendem Guthaben.
   - **Refund:** je fehlgeschlagenem Item (`item_failed`) über den tatsächlich belasteten Item-VK (inkl. verrechneter Render-Anpassung); Job-Abbruch vor Einlieferung → `job_cancel_rest`.
   - **Topup:** ausschließlich im Stripe-Webhook-Handler (`stripe_event`); die Ledger-Zeile speichert zusätzlich `receipt_url` und `stripe_invoice_id` (nullable) für den Belegdownload (§6.6). Solange `FEATURE_STRIPE=false` bucht der Admin manuell (`admin_adjust`, auditiert).
5. **Probeversand** (`is_test`) erzeugt keine Buchung (kostenlos laut API).
6. **Abgleich:** wöchentlicher Integritäts-Check (Cron) `SUM(ledger) == credit_balance_cents` je User; Abweichung → Alarm im Admin + strukturiertes Log.

## Konsequenzen
- Kein Codepfad außerhalb `book_credit` kann Salden ändern (Trigger schützt die Spalte, ADR-0002).
- Negative Salden sind durch CHECK-Constraint + Funktion doppelt ausgeschlossen.
- Race „zwei Tabs bestätigen gleichzeitig den letzten Euro“ löst der Row-Lock: die zweite Buchung schlägt mit `insufficient_funds` fehl und der Job wird nicht angelegt.
