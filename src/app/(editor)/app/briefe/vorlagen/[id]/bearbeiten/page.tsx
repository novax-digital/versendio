import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/server/auth-context";
import { serverEnv } from "@/lib/server/env";
import { getJsonSetting } from "@/lib/server/settings";
import { createClient } from "@/lib/supabase/server";
import { safeParseLetterDocument } from "@/lib/shared/letter-document";
import { de } from "@/lib/i18n/de";
import { LetterEditor } from "../../../editor/letter-editor";

export const metadata: Metadata = { title: de.letters.templateEditTitle };

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile();
  const { id } = await params;
  const supabase = await createClient();

  // Explicit user scoping — the RLS policy alone must not be the only guard.
  const [{ data: template }, { data: senderAddresses }, { data: letterheads }] = await Promise.all([
    supabase
      .from("letter_templates")
      .select("id, name, editor_document, kind")
      .eq("id", id)
      .eq("user_id", profile.id)
      .single(),
    supabase
      .from("sender_addresses")
      .select("id, label, sender_line, city, is_default")
      .eq("user_id", profile.id)
      .order("is_default", { ascending: false }),
    supabase
      .from("letter_templates")
      .select("id, name, editor_document, kind")
      .eq("user_id", profile.id)
      .eq("kind", "letterhead")
      .order("created_at", { ascending: false }),
  ]);

  if (!template || template.kind !== "template") notFound();

  const parsed = safeParseLetterDocument(template.editor_document);
  if (!parsed.success) notFound();

  return (
    <LetterEditor
      letterId={null}
      templateMode
      templateId={template.id}
      initialTitle={template.name}
      initialDocument={parsed.data}
      senderAddresses={senderAddresses ?? []}
      templates={[]}
      letterheads={letterheads ?? []}
      aiMock={!serverEnv().ANTHROPIC_API_KEY}
      aiEnabled={serverEnv().FEATURE_AI_DRAFTS && (await getJsonSetting<boolean>("ai_drafts_enabled", true))}
    />
  );
}
