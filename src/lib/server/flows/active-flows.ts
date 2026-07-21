import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ActiveFlowOption } from "@/lib/shared/flows";

export type { ActiveFlowOption };

/**
 * Active flows owned by the given user, newest first, each with its target list
 * so callers can group by list (enrollment is list-based). Used to offer
 * enrollment when creating/importing contacts. Scoped by user_id explicitly:
 * the flows RLS policy is broadened for admins, so relying on RLS alone could
 * leak other users' flows into an admin's own contact forms.
 */
export async function loadActiveFlows(userId: string): Promise<ActiveFlowOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flows")
    .select("id, name, list_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("active_flows_load_failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((f) => ({ id: f.id, name: f.name, listId: f.list_id }));
}
