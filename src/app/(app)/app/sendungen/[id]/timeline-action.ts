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

/** Timeline for one item (RLS-scoped: readable only via item ownership). */
export async function loadItemTimelineAction(itemId: string): Promise<TimelineEvent[]> {
  await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("status_events")
    .select("id, status, details, occurred_at, event_type")
    .eq("item_id", itemId)
    .order("occurred_at", { ascending: true })
    .limit(50);
  return (data ?? []) as TimelineEvent[];
}
