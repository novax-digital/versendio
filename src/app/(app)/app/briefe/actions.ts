"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { blockedActionError, requireProfile } from "@/lib/server/auth-context";
import { renderEditorLetter } from "@/lib/server/pdf/render-editor";
import { findUnsupportedChars } from "@/lib/server/pdf/fonts";
import { sampleRecipient } from "@/lib/server/pdf/sample-recipient";
import { downloadObject } from "@/lib/server/storage";
import { type ActionResult, fieldErrorsFromZod } from "@/lib/server/action-result";
import { checkRateLimit, clientIp } from "@/lib/server/rate-limit";
import { uploadObject, removeObject, BUCKETS } from "@/lib/server/storage";
import { validateLetterPdf } from "@/lib/server/pdf/validate";
import { isSubmittable } from "@/lib/shared/validation-result";
import type { PdfValidation } from "@/lib/shared/validation-result";
import { saveEditorLetterSchema, saveTemplateSchema, letterTitleSchema } from "@/lib/shared/schemas/letter";
import { hasPlaceholders } from "@/lib/shared/placeholders";
import { LIMITS } from "@/lib/shared/schablone";
import { de } from "@/lib/i18n/de";

// Carries the validation report on both success and failure so the UI can show
// findings even when the upload was rejected.
export type UploadLetterResult =
  | { ok: true; letterId: string; validation: PdfValidation }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; validation?: PdfValidation };

const MAX_UPLOAD = LIMITS.maxFileSizeBytes;

export async function uploadLetterAction(
  _prev: unknown,
  formData: FormData,
): Promise<UploadLetterResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const ip = await clientIp();
  if (!(await checkRateLimit("upload", `${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const titleParse = letterTitleSchema.safeParse(formData.get("title"));
  const file = formData.get("file");
  if (!titleParse.success) {
    return { ok: false, error: "", fieldErrors: { title: titleParse.error.issues[0].message } };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: de.letters.noFile };
  }
  if (file.type !== "application/pdf") {
    return { ok: false, error: de.letters.notPdf };
  }
  if (file.size > MAX_UPLOAD) {
    return { ok: false, error: de.letters.tooLarge };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = await validateLetterPdf(bytes);

  // Hard errors: don't persist — the user must fix and re-upload.
  if (!isSubmittable(validation)) {
    return { ok: false, error: de.letters.validationFailed, validation };
  }

  const letterId = randomUUID();
  const storagePath = `${profile.id}/letters/${letterId}.pdf`;
  const upload = await uploadObject(BUCKETS.letters, storagePath, bytes, "application/pdf");
  if (!upload.ok) {
    return { ok: false, error: de.common.genericError };
  }

  // sheet_count reflects what will physically be sent: the cover page adds a
  // sheet and can push the letter into the next postage tier. Send-time
  // pricing recomputes from the final merged PDF (ADR-0006 §4); this keeps the
  // stored value and UI display consistent until then.
  const coverSheets = validation.needsCoverLetter ? 1 : 0;

  const supabase = await createClient();
  const { error } = await supabase.from("letters").insert({
    id: letterId,
    user_id: profile.id,
    title: titleParse.data,
    source: "upload",
    storage_path: storagePath,
    page_count: validation.pageCount,
    sheet_count: (validation.sheetCountSimplex ?? 0) + coverSheets,
    file_size_bytes: validation.fileSizeBytes,
    validation: validation as unknown as Record<string, unknown>,
    address_zone_result: validation.addressZoneResult,
    needs_cover_letter: validation.needsCoverLetter,
    use_cover_letter: validation.needsCoverLetter,
    has_placeholders: false,
    status: "ready",
  });
  if (error) {
    await removeObject(BUCKETS.letters, storagePath);
    console.error("letter_insert_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app/briefe");
  return { ok: true, letterId, validation };
}

export async function saveEditorLetterAction(
  _prev: unknown,
  input: unknown,
): Promise<ActionResult<{ letterId: string }>> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const ip = await clientIp();
  if (!(await checkRateLimit("upload", `${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const parsed = saveEditorLetterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: de.letters.saveFailed, fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  const doc = parsed.data.document;
  const textBlocks = doc.blocks.filter(
    (b): b is Extract<typeof b, { text: string }> =>
      b.type === "text" || b.type === "subject" || b.type === "heading",
  );
  // Header/footer are placeholder- and glyph-bearing surfaces like body blocks.
  const allTexts = [...textBlocks.map((b) => b.text), doc.header.text, doc.footer.text];
  const placeholders = allTexts.some((t) => hasPlaceholders(t));

  // One shared validation path (ADR-0006): render with a sample recipient and
  // validate exactly like an upload — catches page/size overruns early.
  let validation: PdfValidation;
  try {
    const rendered = await renderEditorLetter({
      document: doc,
      senderLine: "Absender · Muster · 00000 Ort",
      recipient: sampleRecipient(),
      loadImage: async (path) => {
        // Ownership boundary: asset paths are keyed <userId>/… at upload time;
        // a document must never be able to embed another tenant's objects.
        if (!path.startsWith(`${profile.id}/`)) return null;
        const bytes = await downloadObject(BUCKETS.assets, path);
        if (!bytes) return null;
        return { bytes, mime: path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg" };
      },
    });
    validation = await validateLetterPdf(rendered);
  } catch (err) {
    console.error("editor_render_failed", { error: err instanceof Error ? err.message : "unknown" });
    return { ok: false, error: de.letters.saveFailed };
  }
  if (!isSubmittable(validation)) {
    return { ok: false, error: de.letters.validationFailed };
  }

  // Glyph coverage: fonts render missing characters silently (tofu / "?"),
  // so surface them as a save-time warning in the validation report.
  try {
    const unsupported = await findUnsupportedChars(doc.theme.fontFamily, allTexts.join("\n"));
    if (unsupported.length > 0) {
      validation.rules.push({
        id: "font_coverage",
        severity: "warning",
        message: `${de.letters.fontCoverageWarning} ${unsupported.slice(0, 12).join(" ")}`,
      });
    }
  } catch {
    // Coverage check is best-effort; never block a save on it.
  }

  const supabase = await createClient();
  const values = {
    user_id: profile.id,
    title: parsed.data.title,
    source: "editor" as const,
    editor_document: doc as unknown as Record<string, unknown>,
    has_placeholders: placeholders,
    page_count: validation.pageCount,
    sheet_count: validation.sheetCountSimplex,
    validation: validation as unknown as Record<string, unknown>,
    address_zone_result: validation.addressZoneResult,
    needs_cover_letter: false,
    status: "ready" as const,
  };

  if (parsed.data.id) {
    // A queued send renders the LIVE document at dispatch time (ADR-0006 §4);
    // changing the letter now could silently re-price already-confirmed items.
    const { data: activeItems } = await supabase
      .from("send_job_items")
      .select("id, send_jobs!inner(letter_id)")
      .eq("send_jobs.letter_id", parsed.data.id)
      .in("status", ["pending", "on_hold_funds", "submitting"])
      .limit(1);
    if (activeItems && activeItems.length > 0) {
      return { ok: false, error: de.letters.activeSendJobsBlockSave };
    }

    // Guard the source so an upload letter can't be flipped into an editor one.
    const { data: updated, error } = await supabase
      .from("letters")
      .update(values)
      .eq("id", parsed.data.id)
      .eq("source", "editor")
      .select("id")
      .maybeSingle();
    if (error || !updated) {
      console.error("letter_update_failed", { error: error?.message ?? "not_found_or_wrong_source" });
      return { ok: false, error: de.letters.saveFailed };
    }
    revalidatePath("/app/briefe");
    return { ok: true, data: { letterId: parsed.data.id } };
  }

  const { data, error } = await supabase.from("letters").insert(values).select("id").single();
  if (error || !data) {
    console.error("letter_insert_failed", { error: error?.message });
    return { ok: false, error: de.letters.saveFailed };
  }
  revalidatePath("/app/briefe");
  return { ok: true, data: { letterId: data.id } };
}

const MAX_ASSET = 5 * 1024 * 1024;
const ASSET_MIME = new Set(["image/png", "image/jpeg"]);

export async function uploadAssetAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ path: string }>> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const ip = await clientIp();
  if (!(await checkRateLimit("upload", `${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: de.letters.noFile };
  }
  if (!ASSET_MIME.has(file.type)) {
    return { ok: false, error: de.letters.assetNotImage };
  }
  if (file.size > MAX_ASSET) {
    return { ok: false, error: de.letters.assetTooLarge };
  }

  const ext = file.type === "image/png" ? "png" : "jpg";
  const path = `${profile.id}/logos/${randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const upload = await uploadObject(BUCKETS.assets, path, bytes, file.type);
  if (!upload.ok) return { ok: false, error: de.common.genericError };

  return { ok: true, data: { path } };
}

export async function saveTemplateAction(
  _prev: unknown,
  input: unknown,
): Promise<ActionResult<{ templateId: string }>> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const ip = await clientIp();
  if (!(await checkRateLimit("upload", `${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const parsed = saveTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: de.letters.saveFailed, fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("letter_templates")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) >= 100) {
    return { ok: false, error: de.letters.tooManyTemplates };
  }
  const { data, error } = await supabase
    .from("letter_templates")
    .insert({
      user_id: profile.id,
      name: parsed.data.name,
      editor_document: parsed.data.document as unknown as Record<string, unknown>,
      kind: parsed.data.kind,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("template_insert_failed", { error: error?.message });
    return { ok: false, error: de.letters.saveFailed };
  }
  return { ok: true, data: { templateId: data.id } };
}

export async function deleteLetterAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  await requireProfile();
  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const supabase = await createClient();
  const { data: letter } = await supabase
    .from("letters")
    .select("storage_path")
    .eq("id", parsed.data.id)
    .single();

  const { error } = await supabase.from("letters").delete().eq("id", parsed.data.id);
  if (error) {
    console.error("letter_delete_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  if (letter?.storage_path) {
    await removeObject(BUCKETS.letters, letter.storage_path);
  }
  revalidatePath("/app/briefe");
  return { ok: true };
}

export async function setCoverLetterAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  await requireProfile();
  const parsed = z
    .object({ id: z.string().uuid(), use: z.enum(["true", "false"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const useCover = parsed.data.use === "true";
  const supabase = await createClient();

  // Keep sheet_count in sync with the cover choice (cover adds one sheet).
  const { data: letter } = await supabase
    .from("letters")
    .select("page_count")
    .eq("id", parsed.data.id)
    .single();

  const { error } = await supabase
    .from("letters")
    .update({
      use_cover_letter: useCover,
      sheet_count: (letter?.page_count ?? 0) + (useCover ? 1 : 0),
    })
    .eq("id", parsed.data.id);
  if (error) {
    console.error("letter_cover_update_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath(`/app/briefe/${parsed.data.id}`);
  return { ok: true };
}
