import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/server/auth-context";
import { loadActiveRegisteredOptions } from "@/lib/server/pricing/load";
import type { LetterOption, ListOption, SenderOption, RegisteredOption } from "./flow-builder";

/** Shared option lists for the flow builder (create + edit). RLS-scoped reads
 *  except the MOCO connection probe (service-role table, safe field only). */
export async function loadFlowBuilderOptions(): Promise<{
  letters: LetterOption[];
  lists: ListOption[];
  senders: SenderOption[];
  availableRegistered: RegisteredOption[];
  mocoConnected: boolean;
}> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [letters, lists, senders, availableRegistered] = await Promise.all([
    supabase
      .from("letters")
      .select("id, title, sheet_count")
      .eq("status", "ready")
      // Explicit user scoping — the RLS policy alone must not be the only guard.
      .eq("user_id", profile.id)
      // Uploads without cover letter carry one fixed printed address and can
      // never serve a flow's changing recipients (E203 guard in upsert too).
      .or("source.neq.upload,use_cover_letter.eq.true")
      .order("created_at", { ascending: false })
      .then((r) => r.data ?? []),
    supabase
      .from("lead_lists")
      .select("id, name")
      // Auto-created flow lists are fed by exactly one flow (manually or by
      // the MOCO scanner) — offering them as targets for OTHER flows would
      // double every recipient's charged letters.
      .neq("source", "flow")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .then((r) => r.data ?? []),
    supabase
      .from("sender_addresses")
      .select("id, label, is_default")
      .eq("user_id", profile.id)
      .order("is_default", { ascending: false })
      .then((r) => r.data ?? []),
    loadActiveRegisteredOptions(),
  ]);
  const { data: moco } = await createAdminClient()
    .from("moco_accounts")
    .select("user_id")
    .eq("user_id", profile.id)
    .maybeSingle();
  return { letters, lists, senders, availableRegistered, mocoConnected: moco != null };
}
