import type { Metadata } from "next";
import { requireProfile } from "@/lib/server/auth-context";
import { serverEnv } from "@/lib/server/env";
import { getJsonSetting } from "@/lib/server/settings";
import { createClient } from "@/lib/supabase/server";
import { emptyLetterDocument, safeParseLetterDocument } from "@/lib/shared/letter-document";
import { de } from "@/lib/i18n/de";
import { LetterEditor } from "./letter-editor";

export const metadata: Metadata = { title: de.letters.editorTitle };

export default async function NewEditorLetterPage({
  searchParams,
}: {
  searchParams: Promise<{ vorlage?: string }>;
}) {
  await requireProfile();
  const { vorlage } = await searchParams;
  const supabase = await createClient();
  const [{ data: senderAddresses }, { data: allTemplates }] = await Promise.all([
    supabase
      .from("sender_addresses")
      .select("id, label, sender_line, city, is_default")
      .order("is_default", { ascending: false }),
    supabase
      .from("letter_templates")
      .select("id, name, editor_document, kind")
      .order("created_at", { ascending: false }),
  ]);

  const addresses = senderAddresses ?? [];

  // "Brief aus Vorlage erstellen": prefill a fresh, unsaved letter from the
  // chosen template. Falls back to a blank document if the id is unknown or the
  // stored document no longer parses.
  const source = vorlage
    ? (allTemplates ?? []).find((t) => t.id === vorlage && t.kind === "template")
    : undefined;
  const parsedSource = source ? safeParseLetterDocument(source.editor_document) : null;

  const doc = parsedSource?.success ? parsedSource.data : emptyLetterDocument();
  doc.senderAddressId =
    doc.senderAddressId ?? addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? null;
  const initialTitle = source && parsedSource?.success ? source.name : "";

  return (
    <LetterEditor
      letterId={null}
      initialTitle={initialTitle}
      initialDocument={doc}
      senderAddresses={addresses}
      templates={(allTemplates ?? []).filter((t) => t.kind === "template")}
      letterheads={(allTemplates ?? []).filter((t) => t.kind === "letterhead")}
      aiMock={!serverEnv().ANTHROPIC_API_KEY}
      aiEnabled={serverEnv().FEATURE_AI_DRAFTS && (await getJsonSetting<boolean>("ai_drafts_enabled", true))}
    />
  );
}
