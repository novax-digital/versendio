"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { sanitizeSearchTerm } from "@/lib/shared/search-term";

/** Lightweight contact search for the add-to-list combobox (owner-scoped). */
export async function searchContactsAction(term: string) {
  const profile = await requireProfile();
  const cleaned = sanitizeSearchTerm(term);
  if (cleaned.length < 2) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, company, city")
    // Explicit user scoping — the RLS policy alone must not be the only guard.
    .eq("user_id", profile.id)
    .or(
      `first_name.ilike.%${cleaned}%,last_name.ilike.%${cleaned}%,company.ilike.%${cleaned}%,city.ilike.%${cleaned}%`,
    )
    .limit(8);

  return data ?? [];
}
