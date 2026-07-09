import type { Metadata } from "next";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { emptyLetterDocument } from "@/lib/shared/letter-document";
import { de } from "@/lib/i18n/de";
import { LetterEditor } from "./letter-editor";

export const metadata: Metadata = { title: de.letters.editorTitle };

export default async function NewEditorLetterPage() {
  await requireProfile();
  const supabase = await createClient();
  const [{ data: senderAddresses }, { data: templates }] = await Promise.all([
    supabase
      .from("sender_addresses")
      .select("id, label, sender_line, is_default")
      .order("is_default", { ascending: false }),
    supabase
      .from("letter_templates")
      .select("id, name, editor_document")
      .order("created_at", { ascending: false }),
  ]);

  const addresses = senderAddresses ?? [];
  const doc = emptyLetterDocument();
  doc.senderAddressId = addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? null;

  return (
    <LetterEditor
      letterId={null}
      initialTitle=""
      initialDocument={doc}
      senderAddresses={addresses}
      templates={templates ?? []}
    />
  );
}
