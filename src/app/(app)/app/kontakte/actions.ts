"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { blockedActionError, requireProfile } from "@/lib/server/auth-context";
import { type ActionResult, fieldErrorsFromZod } from "@/lib/server/action-result";
import { checkRateLimit, clientIp } from "@/lib/server/rate-limit";
import { uploadObject, downloadObject, removeObject, BUCKETS } from "@/lib/server/storage";
import { parseImportFile } from "@/lib/server/import/parse-file";
import { suggestMapping, type ContactField } from "@/lib/shared/import/mapping";
import { validateImportRow, dedupKey, type RowError } from "@/lib/shared/import/validate-row";
import { contactSchema, commitImportSchema } from "@/lib/shared/schemas/contact";
import { de } from "@/lib/i18n/de";

// --- contact CRUD -----------------------------------------------------------

export async function upsertContactAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const raw = Object.fromEntries(formData);
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "", fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  const values = {
    user_id: profile.id,
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
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("contacts").update(values).eq("id", id)
    : await supabase.from("contacts").insert(values);

  if (error) {
    console.error("contact_save_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app/kontakte");
  return { ok: true };
}

export async function deleteContactAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  await requireProfile();
  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const supabase = await createClient();
  const { error } = await supabase.from("contacts").delete().eq("id", parsed.data.id);
  if (error) {
    console.error("contact_delete_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/kontakte");
  return { ok: true };
}

// --- import: step 1 (upload + header analysis) ------------------------------

export type StartImportResult =
  | {
      ok: true;
      importPath: string;
      fileName: string;
      headers: string[];
      suggested: Record<number, ContactField | null>;
      previewRows: string[][];
      totalRows: number;
    }
  | { ok: false; error: string };

const IMPORT_MIME = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export async function startImportAction(
  _prev: unknown,
  formData: FormData,
): Promise<StartImportResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const ip = await clientIp();
  if (!(await checkRateLimit("upload", `${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: de.contacts.importNoFile };
  }
  const lower = file.name.toLowerCase();
  const extOk = lower.endsWith(".csv") || lower.endsWith(".xlsx") || lower.endsWith(".xls");
  if (!extOk && !IMPORT_MIME.has(file.type)) {
    return { ok: false, error: de.contacts.importWrongType };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, error: de.contacts.importTooLarge };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parseImportFile(bytes, file.name);
  } catch (err) {
    console.error("import_parse_failed", { error: err instanceof Error ? err.message : "unknown" });
    return { ok: false, error: de.contacts.importParseFailed };
  }
  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    return { ok: false, error: de.contacts.importEmpty };
  }

  const ext = lower.endsWith(".csv") ? "csv" : "xlsx";
  const importPath = `${profile.id}/${randomUUID()}.${ext}`;
  const upload = await uploadObject(
    BUCKETS.imports,
    importPath,
    bytes,
    file.type || "application/octet-stream",
  );
  if (!upload.ok) return { ok: false, error: de.common.genericError };

  return {
    ok: true,
    importPath,
    fileName: file.name,
    headers: parsed.headers,
    suggested: suggestMapping(parsed.headers),
    previewRows: parsed.rows.slice(0, 5),
    totalRows: parsed.rows.length,
  };
}

// --- import: step 2 (commit with mapping) -----------------------------------

export type CommitImportResult =
  | {
      ok: true;
      imported: number;
      duplicates: number;
      failed: number;
      listId: string | null;
      errorRows: RowError[];
      headers: string[];
    }
  | { ok: false; error: string };

const INSERT_BATCH = 500;
const ERROR_REPORT_CAP = 500;

export async function commitImportAction(
  _prev: unknown,
  input: unknown,
): Promise<CommitImportResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const parsed = commitImportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  // The imports bucket is RLS-scoped, but check the prefix explicitly too.
  if (!parsed.data.importPath.startsWith(`${profile.id}/`)) {
    return { ok: false, error: de.common.genericError };
  }

  const mapping: Record<number, ContactField | null> = {};
  for (const [k, v] of Object.entries(parsed.data.mapping)) {
    mapping[Number(k)] = v;
  }
  const mappedFields = new Set(Object.values(mapping).filter(Boolean));
  if (!mappedFields.has("street") || !mappedFields.has("zip") || !mappedFields.has("city")) {
    return { ok: false, error: de.contacts.importMappingIncomplete };
  }

  const bytes = await downloadObject(BUCKETS.imports, parsed.data.importPath);
  if (!bytes) return { ok: false, error: de.contacts.importExpired };

  let table;
  try {
    // Parser choice from the server-controlled stored path, never the
    // client-supplied fileName (which is display-only).
    table = await parseImportFile(bytes, parsed.data.importPath);
  } catch {
    return { ok: false, error: de.contacts.importParseFailed };
  }

  // Validate all rows.
  const errorRows: RowError[] = [];
  const validContacts: {
    key: string;
    rowNumber: number;
    contact: Extract<ReturnType<typeof validateImportRow>, { ok: true }>["contact"];
  }[] = [];

  table.rows.forEach((row, i) => {
    const rowNumber = i + 2; // 1-based incl. header row
    const result = validateImportRow(row, mapping);
    if (result.ok) {
      validContacts.push({ key: dedupKey(result.contact), rowNumber, contact: result.contact });
    } else if (errorRows.length < ERROR_REPORT_CAP) {
      errorRows.push({ rowNumber, errors: result.errors, raw: row });
    }
  });
  const failedTotal = table.rows.length - validContacts.length;

  // Duplicate detection: intra-file + against existing contacts (dedup_key).
  const supabase = await createClient();
  const seen = new Set<string>();
  const uniqueContacts: typeof validContacts = [];
  let duplicates = 0;
  for (const entry of validContacts) {
    if (seen.has(entry.key)) {
      duplicates++;
    } else {
      seen.add(entry.key);
      uniqueContacts.push(entry);
    }
  }

  // A failed dedup lookup must abort the import — degrading to "insert
  // everything" would silently create duplicates. Owner-scoped explicitly:
  // admin RLS is broadened, and dedup must never match other users' contacts.
  const existingByKey = new Map<string, string>();
  const keys = uniqueContacts.map((c) => c.key);
  const LOOKUP_BATCH = 200;
  for (let i = 0; i < keys.length; i += LOOKUP_BATCH) {
    const batch = keys.slice(i, i + LOOKUP_BATCH);
    const { data, error } = await supabase
      .from("contacts")
      .select("id, dedup_key")
      .eq("user_id", profile.id)
      .in("dedup_key", batch);
    if (error) {
      console.error("import_dedup_lookup_failed", { error: error.message });
      return { ok: false, error: de.common.genericError };
    }
    for (const row of data ?? []) existingByKey.set(row.dedup_key, row.id);
  }

  const toInsert = uniqueContacts.filter((c) => !existingByKey.has(c.key));
  duplicates += uniqueContacts.length - toInsert.length;

  // Insert new contacts in batches.
  const insertedIds: string[] = [];
  for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
    const batch = toInsert.slice(i, i + INSERT_BATCH).map(({ contact }) => ({
      user_id: profile.id,
      salutation: contact.salutation,
      first_name: contact.firstName,
      last_name: contact.lastName,
      company: contact.company,
      street: contact.street,
      address_extra: contact.addressExtra,
      zip: contact.zip,
      city: contact.city,
      country: contact.country,
      email: contact.email,
    }));
    const { data, error } = await supabase.from("contacts").insert(batch).select("id");
    if (error) {
      console.error("import_insert_failed", { error: error.message });
      return { ok: false, error: de.common.genericError };
    }
    insertedIds.push(...(data ?? []).map((r) => r.id));
  }

  // Optional lead list: new + matched existing contacts become entries.
  let listId: string | null = null;
  if (parsed.data.listName) {
    const { data: list, error: listError } = await supabase
      .from("lead_lists")
      .insert({ user_id: profile.id, name: parsed.data.listName, source: "import" })
      .select("id")
      .single();
    if (listError || !list) {
      console.error("import_list_failed", { error: listError?.message });
      return { ok: false, error: de.common.genericError };
    }
    listId = list.id;

    const memberIds = [
      ...insertedIds,
      ...uniqueContacts.filter((c) => existingByKey.has(c.key)).map((c) => existingByKey.get(c.key)!),
    ];
    for (let i = 0; i < memberIds.length; i += INSERT_BATCH) {
      const entries = memberIds.slice(i, i + INSERT_BATCH).map((contactId) => ({
        list_id: listId,
        contact_id: contactId,
      }));
      const { error: entryError } = await supabase.from("lead_list_entries").insert(entries);
      if (entryError) {
        console.error("import_entries_failed", { error: entryError.message });
        // Compensate: remove the half-filled list (entries cascade) so a retry
        // doesn't leave an orphaned partial list behind. Contacts stay —
        // the dedup check makes a retry idempotent for them.
        await supabase.from("lead_lists").delete().eq("id", listId);
        return { ok: false, error: de.common.genericError };
      }
    }
  }

  // Import file is no longer needed.
  await removeObject(BUCKETS.imports, parsed.data.importPath);

  revalidatePath("/app/kontakte");
  revalidatePath("/app/leadlisten");
  return {
    ok: true,
    imported: insertedIds.length,
    duplicates,
    failed: failedTotal,
    listId,
    errorRows,
    headers: table.headers,
  };
}
