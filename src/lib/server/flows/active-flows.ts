import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Minimal active-flow descriptor for the "add to flow" pickers. */
export type ActiveFlowOption = { id: string; name: string };

/**
 * Active flows owned by the given user, newest first. Used to offer enrollment
 * when creating/importing contacts. Scoped by user_id explicitly: the flows RLS
 * policy is broadened for admins, so relying on RLS alone could leak other
 * users' flows into an admin's own contact forms.
 */
export async function loadActiveFlows(userId: string): Promise<ActiveFlowOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flows")
    .select("id, name")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("active_flows_load_failed", { error: error.message });
    return [];
  }
  return data ?? [];
}
