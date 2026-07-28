"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";

export type TimelineEvent = {
  id: string;
  status: string | null;
  details: string | null;
  occurred_at: string;
  event_type: string;
};

/** Timeline for one item (owner-scoped: item ownership is verified explicitly before reading events). */
export async function loadItemTimelineAction(itemId: string): Promise<TimelineEvent[]> {
  const profile = await requireProfile();
  const supabase = await createClient();

  // status_events has no user_id column — verify item ownership explicitly first;
  // the RLS policy alone must not be the only guard.
  const { data: ownedItem } = await supabase
    .from("send_job_items")
    .select("id")
    .eq("id", itemId)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (!ownedItem) return [];

  const { data } = await supabase
    .from("status_events")
    .select("id, status, details, occurred_at, event_type")
    .eq("item_id", itemId)
    .order("occurred_at", { ascending: true })
    .limit(50);
  return (data ?? []) as TimelineEvent[];
}
