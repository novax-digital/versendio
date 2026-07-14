import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadActiveRegisteredOptions } from "@/lib/server/pricing/load";
import type { LetterOption, ListOption, SenderOption, RegisteredOption } from "./flow-builder";

/** Shared option lists for the flow builder (create + edit). RLS-scoped reads. */
export async function loadFlowBuilderOptions(): Promise<{
  letters: LetterOption[];
  lists: ListOption[];
  senders: SenderOption[];
  availableRegistered: RegisteredOption[];
}> {
  const supabase = await createClient();
  const [letters, lists, senders, availableRegistered] = await Promise.all([
    supabase
      .from("letters")
      .select("id, title, sheet_count")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .then((r) => r.data ?? []),
    supabase
      .from("lead_lists")
      .select("id, name")
      .order("created_at", { ascending: false })
      .then((r) => r.data ?? []),
    supabase
      .from("sender_addresses")
      .select("id, label, is_default")
      .order("is_default", { ascending: false })
      .then((r) => r.data ?? []),
    loadActiveRegisteredOptions(),
  ]);
  return { letters, lists, senders, availableRegistered };
}
