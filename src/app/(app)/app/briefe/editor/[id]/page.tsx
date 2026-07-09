import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { letterDocumentSchema } from "@/lib/shared/letter-document";
import { de } from "@/lib/i18n/de";
import { LetterEditor } from "../letter-editor";

export const metadata: Metadata = { title: de.letters.editorTitle };

export default async function EditEditorLetterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireProfile();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: letter }, { data: senderAddresses }] = await Promise.all([
    supabase.from("letters").select("id, title, source, editor_document").eq("id", id).single(),
    supabase
      .from("sender_addresses")
      .select("id, label, sender_line, is_default")
      .order("is_default", { ascending: false }),
  ]);

  if (!letter || letter.source !== "editor") notFound();

  const parsed = letterDocumentSchema.safeParse(letter.editor_document);
  if (!parsed.success) notFound();

  return (
    <LetterEditor
      letterId={letter.id}
      initialTitle={letter.title}
      initialDocument={parsed.data}
      senderAddresses={senderAddresses ?? []}
      templates={[]}
    />
  );
}
