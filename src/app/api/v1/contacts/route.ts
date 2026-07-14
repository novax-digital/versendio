import { z } from "zod";
import { authenticateApiRequest, apiError, apiJson } from "@/lib/server/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { contactSchema } from "@/lib/shared/schemas/contact";

export const dynamic = "force-dynamic";

/** POST /api/v1/contacts — create a contact for the key's owner. */
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

  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return apiJson(
      {
        error: "validation_error",
        message: "Die Kontaktdaten sind unvollständig oder ungültig.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
      422,
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contacts")
    .insert({
      user_id: userId,
      salutation: parsed.data.salutation || null,
      first_name: parsed.data.firstName || null,
      last_name: parsed.data.lastName || null,
      company: parsed.data.company || null,
      street: parsed.data.street,
      address_extra: parsed.data.addressExtra || null,
      zip: parsed.data.zip,
      city: parsed.data.city,
      country: parsed.data.country,
      email: parsed.data.email || null,
    })
    .select("id, salutation, first_name, last_name, company, street, address_extra, zip, city, country, email, created_at")
    .single();

  if (error || !data) {
    console.error("api_contact_create_failed", { error: error?.message });
    return apiJson({ error: "server_error", message: "Der Kontakt konnte nicht angelegt werden." }, 500);
  }

  return apiJson({ contact: data }, 201);
}

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/v1/contacts — list the key owner's contacts (paginated). */
export async function GET(request: Request) {
  const result = await authenticateApiRequest(request);
  if ("error" in result) return apiError(result.error);
  const { userId } = result.auth;

  const url = new URL(request.url);
  const q = listQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) {
    return apiJson({ error: "validation_error", message: "Ungültige Query-Parameter." }, 422);
  }

  const admin = createAdminClient();
  const { data, count, error } = await admin
    .from("contacts")
    .select(
      "id, salutation, first_name, last_name, company, street, address_extra, zip, city, country, email, created_at",
      { count: "exact" },
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(q.data.offset, q.data.offset + q.data.limit - 1);

  if (error) {
    console.error("api_contact_list_failed", { error: error.message });
    return apiJson({ error: "server_error", message: "Die Kontakte konnten nicht geladen werden." }, 500);
  }

  return apiJson({ contacts: data ?? [], total: count ?? 0, limit: q.data.limit, offset: q.data.offset });
}
