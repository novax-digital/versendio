import type { Metadata } from "next";
import { requireProfile } from "@/lib/server/auth-context";
import { serverEnv } from "@/lib/server/env";
import { getJsonSetting } from "@/lib/server/settings";
import { createClient } from "@/lib/supabase/server";
import { emptyLetterDocument } from "@/lib/shared/letter-document";
import { de } from "@/lib/i18n/de";
import { LetterEditor } from "../../editor/letter-editor";

export const metadata: Metadata = { title: de.letters.newTemplate };

export default async function NewTemplatePage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  // Explicit user scoping — the RLS policy alone must not be the only guard.
  const [{ data: senderAddresses }, { data: letterheads }] = await Promise.all([
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

  const addresses = senderAddresses ?? [];
  const doc = emptyLetterDocument();
  doc.senderAddressId = addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? null;

  return (
    <LetterEditor
      letterId={null}
      templateMode
      templateId={null}
      initialTitle=""
      initialDocument={doc}
      senderAddresses={addresses}
      templates={[]}
      letterheads={letterheads ?? []}
      aiMock={!serverEnv().ANTHROPIC_API_KEY}
      aiEnabled={serverEnv().FEATURE_AI_DRAFTS && (await getJsonSetting<boolean>("ai_drafts_enabled", true))}
    />
  );
}
