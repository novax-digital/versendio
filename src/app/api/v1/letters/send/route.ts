import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticateApiRequest, apiError, apiJson } from "@/lib/server/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { contactSchema } from "@/lib/shared/schemas/contact";
import { loadPricingRows, loadDiscountPercent } from "@/lib/server/pricing/load";
import { calculateLetterPrice } from "@/lib/shared/pricing";
import { isMockMode } from "@/lib/server/env";

export const dynamic = "force-dynamic";

const sendSchema = z.object({
  letterId: z.string().uuid(),
  recipient: z.union([z.object({ contactId: z.string().uuid() }), contactSchema]),
  options: z
    .object({
      color: z.boolean().default(false),
      duplex: z.boolean().default(false),
      registered: z.enum(["none", "einwurf", "einschreiben", "rueckschein"]).default("none"),
    })
    .default({ color: false, duplex: false, registered: "none" }),
  test: z.boolean().default(false),
  // Optional idempotency: reuse the same UUID to make a retry a no-op.
  idempotencyKey: z.string().uuid().optional(),
});

type RecipientSnapshot = {
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  street: string;
  addressExtra: string | null;
  zip: string;
  city: string;
  country: string;
};

/** POST /api/v1/letters/send — send a ready letter to one recipient. */
export async function POST(request: Request) {
  const result = await authenticateApiRequest(request);
  if ("error" in result) return apiError(result.error);
  const { userId } = result.auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiJson({ error: "invalid_json", message: "Ungültiges JSON im Anfragekörper." }, 400);
  }
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return apiJson(
      {
        error: "validation_error",
        message: "Die Sendedaten sind unvollständig oder ungültig.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
      422,
    );
  }

  const admin = createAdminClient();

  // Letter must be ready and owned by the key holder.
  const { data: letter } = await admin
    .from("letters")
    .select("id, status, sheet_count")
    .eq("id", parsed.data.letterId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!letter) return apiJson({ error: "not_found", message: "Brief nicht gefunden." }, 404);
  if (letter.status !== "ready") {
    return apiJson({ error: "letter_not_ready", message: "Der Brief ist nicht versandbereit." }, 409);
  }

  // Resolve the recipient — a stored contact or an inline address.
  const recipient = parsed.data.recipient;
  let snapshot: RecipientSnapshot;
  let contactId: string | null = null;
  if ("contactId" in recipient) {
    const { data: contact } = await admin
      .from("contacts")
      .select("id, salutation, first_name, last_name, company, street, address_extra, zip, city, country")
      .eq("id", recipient.contactId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!contact) return apiJson({ error: "not_found", message: "Kontakt nicht gefunden." }, 404);
    contactId = contact.id;
    snapshot = {
      salutation: contact.salutation,
      firstName: contact.first_name,
      lastName: contact.last_name,
      company: contact.company,
      street: contact.street,
      addressExtra: contact.address_extra,
      zip: contact.zip,
      city: contact.city,
      country: contact.country,
    };
  } else {
    snapshot = {
      salutation: recipient.salutation || null,
      firstName: recipient.firstName || null,
      lastName: recipient.lastName || null,
      company: recipient.company || null,
      street: recipient.street,
      addressExtra: recipient.addressExtra || null,
      zip: recipient.zip,
      city: recipient.city,
      country: recipient.country,
    };
  }

  // Sender snapshot (the user's default sender address).
  const { data: sender } = await admin
    .from("sender_addresses")
    .select("id, label, company, first_name, last_name, street, zip, city, country, sender_line")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();
  if (!sender) {
    return apiJson(
      { error: "no_sender_address", message: "Keine Standard-Absenderadresse hinterlegt." },
      409,
    );
  }

  // Price via the single pricing truth (same as the wizard + booking).
  const sheets = Math.max(1, letter.sheet_count ?? 1);
  const { data: profile } = await admin
    .from("profiles")
    .select("plan_id")
    .eq("id", userId)
    .maybeSingle();
  const [rows, discountPercent] = await Promise.all([
    loadPricingRows(),
    loadDiscountPercent(profile?.plan_id ?? null),
  ]);

  let price;
  try {
    price = calculateLetterPrice(rows, {
      sheets,
      isColor: parsed.data.options.color,
      isDuplex: parsed.data.options.duplex,
      registered: parsed.data.options.registered,
      discountPercent,
    });
  } catch {
    return apiJson({ error: "pricing_unavailable", message: "Preis konnte nicht ermittelt werden." }, 500);
  }

  const clientToken = parsed.data.idempotencyKey ?? randomUUID();
  const { data: jobId, error } = await admin.rpc("confirm_send_job", {
    p_user_id: userId,
    p_client_token: clientToken,
    p_letter_id: letter.id,
    p_sender_snapshot: sender,
    p_is_color: parsed.data.options.color,
    p_is_duplex: parsed.data.options.duplex,
    p_registered: parsed.data.options.registered,
    p_is_test: parsed.data.test,
    p_scheduled_release_at: null,
    p_provider: isMockMode() ? "mock" : "epost",
    p_total_vk_cents: price.vkCents,
    p_total_ek_cents: price.ekCents,
    p_items: [
      {
        contact_id: contactId,
        recipient_snapshot: snapshot,
        sheet_count: sheets,
        vk_cents: price.vkCents,
        ek_cents: price.ekCents,
        pricing_snapshot: { discountPercent, rows, sheets },
      },
    ],
  });

  if (error) {
    if (error.message.includes("insufficient_funds")) {
      return apiJson(
        { error: "insufficient_funds", message: "Nicht genügend Guthaben für diesen Versand." },
        402,
      );
    }
    console.error("api_send_failed", { error: error.message });
    return apiJson({ error: "server_error", message: "Der Versand konnte nicht ausgelöst werden." }, 500);
  }

  return apiJson(
    {
      jobId,
      status: "queued",
      test: parsed.data.test,
      priceCents: parsed.data.test ? 0 : price.vkCents,
    },
    201,
  );
}
