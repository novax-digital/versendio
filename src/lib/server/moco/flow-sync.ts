import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/server/crypto";
import { contactSchema } from "@/lib/shared/schemas/contact";
import { parseMocoRecipientAddress } from "@/lib/shared/moco-address";
import {
  getMocoCompany,
  getMocoInvoice,
  listMocoCompanies,
  listMocoInvoices,
  listMocoReminders,
  type MocoAuth,
  type MocoCompany,
} from "./client";

/**
 * MOCO → flow feeder: scans MOCO events (new invoice / new reminder / new
 * customer) for active flows with source='moco' and pushes each recipient as
 * a contact into the flow's bound lead list. Everything downstream is the
 * UNCHANGED flows machinery (enrollment trigger, lifetime dedup per
 * flow+contact, scheduler charging via confirm_send_job).
 *
 * Progress model: every handled event is recorded in moco_flow_processed
 * (PK flow/doc_type/moco_id) BEFORE the per-tick cap is applied on the next
 * run — the scan window (which never advances past activation) therefore
 * drains instead of letting handled events starve the cap. Enrollment
 * uniqueness stays the money-correctness backstop; markers are progress
 * bookkeeping only.
 *
 * Watermark: only events whose CREATION instant is at/after the flow's
 * activation enroll ("ab Aktivierung", no same-day backfill; unknown
 * timestamps are skipped, never treated as new). The MOCO date_from query
 * param is kept as a cheap server-side pre-filter on business dates.
 */

const MAX_ENROLL_PER_FLOW_TICK = 20;

type MocoFlowRow = {
  id: string;
  user_id: string;
  list_id: string;
  moco_trigger: "invoice" | "reminder" | "customer";
  moco_invoice_status: string;
  activated_at: string | null;
  delay_minutes: number;
  letter_id: string;
  is_color: boolean;
  is_duplex: boolean;
  registered: string;
};

type AccountAuthRow = { user_id: string; subdomain: string; api_key_enc: string };

function berlinDate(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(iso));
}

export type MocoFlowSyncStats = { flows: number; enrolled: number };

export async function runMocoFlowSync(deadline: number): Promise<MocoFlowSyncStats> {
  const admin = createAdminClient();
  const stats: MocoFlowSyncStats = { flows: 0, enrolled: 0 };

  const { data: flows, error } = await admin
    .from("flows")
    .select(
      "id, user_id, list_id, moco_trigger, moco_invoice_status, activated_at, delay_minutes, letter_id, is_color, is_duplex, registered",
    )
    .eq("source", "moco")
    .eq("is_active", true)
    .not("moco_trigger", "is", null);
  if (error || !flows || flows.length === 0) {
    if (error) console.error("moco_flow_scan_failed", { error: error.message });
    return stats;
  }

  const userIds = [...new Set(flows.map((f) => f.user_id))];
  const { data: accounts } = await admin
    .from("moco_accounts")
    .select("user_id, subdomain, api_key_enc")
    .in("user_id", userIds)
    .eq("status", "active");
  const authByUser = new Map<string, MocoAuth>();
  for (const acc of (accounts ?? []) as AccountAuthRow[]) {
    authByUser.set(acc.user_id, {
      subdomain: acc.subdomain,
      apiKey: decryptSecret(acc.api_key_enc),
    });
  }

  for (const flow of flows as MocoFlowRow[]) {
    if (Date.now() > deadline) break;
    const auth = authByUser.get(flow.user_id);
    if (!auth || !flow.activated_at) {
      // Disconnected/errored account with an active MOCO flow: enrollment is
      // stalled — surface it in the logs (the flow UI shows the account state
      // on the integration page).
      if (!auth) console.error("moco_flow_account_unavailable", { flowId: flow.id });
      continue;
    }
    stats.flows += 1;
    try {
      stats.enrolled += await scanFlow(admin, auth, flow, deadline);
    } catch (err) {
      // Per-flow isolation; transient MOCO problems retry on the next tick.
      console.error("moco_flow_sync_failed", {
        flowId: flow.id,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return stats;
}

/** One candidate event, before company/address resolution. */
type FlowEvent = {
  mocoId: number;
  companyId: number | null; // known for invoice/customer, resolved later for reminders
  addressInvoiceId: number | null;
  addressBlock: string | null;
  companyFallback: MocoCompany | null;
};

async function scanFlow(
  admin: ReturnType<typeof createAdminClient>,
  auth: MocoAuth,
  flow: MocoFlowRow,
  deadline: number,
): Promise<number> {
  const activatedTs = new Date(flow.activated_at!).getTime();
  const dateFrom = berlinDate(flow.activated_at!);
  const events = new Map<number, FlowEvent>();

  // Collection is list-only — the per-event invoice fetch for reminders
  // happens AFTER the processed-filter and cap, so API usage per tick stays
  // bounded regardless of backlog size.
  if (flow.moco_trigger === "invoice") {
    for (const inv of await listMocoInvoices(auth, {
      status: flow.moco_invoice_status,
      dateFrom,
    })) {
      // Creation-instant watermark: business dates (date_from) would pull in
      // same-day documents created BEFORE activation. Unknown instant → skip.
      if (inv.createdAtTs === null || inv.createdAtTs < activatedTs) continue;
      events.set(inv.id, {
        mocoId: inv.id,
        companyId: inv.customer_id,
        addressInvoiceId: inv.id,
        addressBlock: inv.recipient_address || null,
        companyFallback: null,
      });
    }
  } else if (flow.moco_trigger === "reminder") {
    for (const rem of await listMocoReminders(auth, { dateFrom })) {
      if (rem.createdAtTs === null || rem.createdAtTs < activatedTs || !rem.invoice) continue;
      events.set(rem.id, {
        mocoId: rem.id,
        companyId: null,
        addressInvoiceId: rem.invoice.id,
        addressBlock: null,
        companyFallback: null,
      });
    }
  } else {
    for (const company of await listMocoCompanies(auth)) {
      if (company.createdAtTs === null || company.createdAtTs < activatedTs) continue;
      events.set(company.id, {
        mocoId: company.id,
        companyId: company.id,
        addressInvoiceId: null,
        addressBlock: null,
        companyFallback: company,
      });
    }
  }

  // Drop already-processed events BEFORE the cap — otherwise handled events
  // permanently occupy the cap slots and everything behind them starves.
  const fresh = await filterUnprocessed(admin, flow, [...events.values()]);
  const batch = fresh.slice(0, MAX_ENROLL_PER_FLOW_TICK);

  let enrolled = 0;
  for (const event of batch) {
    if (Date.now() > deadline) break;

    // Resolve the company for reminders (bounded: ≤ cap fetches per tick).
    let companyId = event.companyId;
    let addressBlock = event.addressBlock;
    if (companyId === null && event.addressInvoiceId !== null) {
      const invoice = await getMocoInvoice(auth, event.addressInvoiceId);
      companyId = invoice.customer_id;
      addressBlock = invoice.recipient_address || null;
    }
    if (companyId === null) {
      // No linked company — nothing to enroll; mark handled so the slot frees.
      await markProcessed(admin, flow, event.mocoId);
      continue;
    }

    const contactId = await upsertMocoContact(admin, auth, flow.user_id, {
      companyId,
      addressBlock,
      companyFallback: event.companyFallback,
    });
    if (!contactId) {
      // Unparseable/invalid address (logged in upsertMocoContact): flow
      // enrollment is best-effort — mark handled instead of clogging the cap.
      await markProcessed(admin, flow, event.mocoId);
      continue;
    }

    // Unique (list, contact): replays are no-ops; a fresh insert fires the
    // enrollment trigger (which dedups per flow+contact).
    await admin
      .from("lead_list_entries")
      .upsert(
        { list_id: flow.list_id, contact_id: contactId },
        { onConflict: "list_id,contact_id", ignoreDuplicates: true },
      );

    // Belt-and-braces enrollment: the trigger only enrolls flows active AT
    // INSERT time — if the flow was toggled inactive for the split second of
    // the insert, this upsert closes the hole. Duplicates are ignored via
    // the (flow_id, contact_id) unique index.
    const scheduledAt = new Date(Date.now() + flow.delay_minutes * 60_000).toISOString();
    const { data: enrolledRow } = await admin
      .from("flow_enrollments")
      .upsert(
        {
          flow_id: flow.id,
          user_id: flow.user_id,
          contact_id: contactId,
          scheduled_send_at: scheduledAt,
          next_attempt_at: scheduledAt,
          letter_id: flow.letter_id,
          is_color: flow.is_color,
          is_duplex: flow.is_duplex,
          registered: flow.registered,
        },
        { onConflict: "flow_id,contact_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();

    await markProcessed(admin, flow, event.mocoId);
    if (enrolledRow) enrolled += 1;
  }
  return enrolled;
}

async function markProcessed(
  admin: ReturnType<typeof createAdminClient>,
  flow: MocoFlowRow,
  mocoId: number,
): Promise<void> {
  await admin
    .from("moco_flow_processed")
    .upsert(
      { flow_id: flow.id, doc_type: flow.moco_trigger, moco_id: mocoId },
      { onConflict: "flow_id,doc_type,moco_id", ignoreDuplicates: true },
    );
}

async function filterUnprocessed(
  admin: ReturnType<typeof createAdminClient>,
  flow: MocoFlowRow,
  events: FlowEvent[],
): Promise<FlowEvent[]> {
  const seen = new Set<number>();
  const ids = events.map((e) => e.mocoId);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await admin
      .from("moco_flow_processed")
      .select("moco_id")
      .eq("flow_id", flow.id)
      .eq("doc_type", flow.moco_trigger)
      .in("moco_id", chunk);
    if (error) {
      // Fail closed for this tick: processing without the dedup set could
      // re-run resolution work; nothing is lost by waiting a tick.
      console.error("moco_flow_processed_check_failed", { error: error.message });
      return [];
    }
    for (const row of data ?? []) seen.add(row.moco_id);
  }
  return events.filter((e) => !seen.has(e.mocoId));
}

/**
 * Finds or creates the contact for a MOCO company (identity: company id).
 * Returns null when no parseable postal address exists — flow enrollment is
 * best-effort; the document auto-send path is the one that fails loudly.
 */
async function upsertMocoContact(
  admin: ReturnType<typeof createAdminClient>,
  auth: MocoAuth,
  userId: string,
  recipient: { companyId: number; addressBlock: string | null; companyFallback: MocoCompany | null },
): Promise<string | null> {
  const { data: existing } = await admin
    .from("contacts")
    .select("id")
    .eq("user_id", userId)
    .eq("moco_company_id", recipient.companyId)
    .maybeSingle();
  if (existing) return existing.id;

  const company = recipient.companyFallback ?? (await getMocoCompany(auth, recipient.companyId));

  // Prefer the invoice's recipient block (exactly what MOCO prints); fall
  // back to the company address, prepending the name if the block lacks it.
  let parsed = recipient.addressBlock
    ? parseMocoRecipientAddress(recipient.addressBlock, company.country_code)
    : { ok: false as const, reason: "empty" as const };
  if (!parsed.ok && company.address) {
    parsed = parseMocoRecipientAddress(company.address, company.country_code);
    if (!parsed.ok) {
      parsed = parseMocoRecipientAddress(
        `${company.name}\n${company.address}`,
        company.country_code,
      );
    }
  }
  if (!parsed.ok) {
    console.error("moco_flow_contact_unparseable", { companyId: recipient.companyId });
    return null;
  }

  const check = contactSchema.safeParse({
    company: parsed.recipient.company,
    addressExtra: parsed.recipient.addressExtra ?? undefined,
    street: parsed.recipient.street,
    zip: parsed.recipient.zip,
    city: parsed.recipient.city,
    country: parsed.recipient.country,
  });
  if (!check.success) {
    console.error("moco_flow_contact_invalid", { companyId: recipient.companyId });
    return null;
  }

  const { data: created, error } = await admin
    .from("contacts")
    .insert({
      user_id: userId,
      company: check.data.company || company.name.slice(0, 160),
      street: check.data.street,
      address_extra: check.data.addressExtra || null,
      zip: check.data.zip,
      city: check.data.city,
      country: check.data.country,
      moco_company_id: recipient.companyId,
    })
    .select("id")
    .maybeSingle();
  if (created) return created.id;

  // Unique-violation race with a concurrent tick: the row exists now.
  if (error) {
    const { data: raced } = await admin
      .from("contacts")
      .select("id")
      .eq("user_id", userId)
      .eq("moco_company_id", recipient.companyId)
      .maybeSingle();
    if (raced) return raced.id;
    console.error("moco_flow_contact_insert_failed", { error: error.message });
  }
  return null;
}
