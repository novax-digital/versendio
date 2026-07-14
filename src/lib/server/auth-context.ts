import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  company: string | null;
  billing_street: string | null;
  billing_zip: string | null;
  billing_city: string | null;
  billing_country: string | null;
  role: "user" | "admin";
  status: "active" | "blocked" | "deleted";
  plan_id: string | null;
  credit_balance_cents: number;
  cost_center: string;
};

/** Current session user + profile, or null. RLS-scoped client. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "id, email, display_name, company, billing_street, billing_zip, billing_city, billing_country, role, status, plan_id, credit_balance_cents, cost_center",
    )
    .eq("id", user.id)
    .single();

  if (error || !profile) return null;
  return profile as Profile;
}

/**
 * Optional 2FA enforcement (choke point for BOTH page renders and Server
 * Actions — a layout-only gate would leave POST actions ungated). Once a user
 * has a verified TOTP factor, the session must be stepped up to AAL2; an
 * enrolled-but-unverified session (aal1 + next aal2) is sent to /mfa. Cached
 * per request so multiple requireProfile() calls make at most one MFA lookup.
 * Fail-open on error so a transient MFA outage never locks users out.
 */
const enforceMfaStepUp = cache(async (): Promise<void> => {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data && data.currentLevel === "aal1" && data.nextLevel === "aal2") {
      redirect("/mfa");
    }
  } catch (err) {
    // redirect() throws a control-flow signal — re-throw it, swallow the rest.
    if (err && typeof err === "object" && "digest" in err) throw err;
  }
});

/** Requires a logged-in, non-deleted user; redirects to /login otherwise. */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile || profile.status === "deleted") redirect("/login");
  await enforceMfaStepUp();
  return profile;
}

/**
 * Requires the admin role AND an active account (defense in depth on top of
 * RLS). Blocking an admin must actually revoke console access — otherwise a
 * compromised admin account cannot be contained. Mirrors `is_admin()` in SQL,
 * which also requires status = 'active'.
 */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin" || profile.status !== "active") redirect("/app");
  return profile;
}

/**
 * For actions blocked users must not perform (uploads, sends, top-ups).
 * Per MASTERPROMPT §6.1 blocked users may still log in and browse (they see a
 * banner), so this guard lives on the sensitive actions, not on login/layout.
 * Returns an error string to surface to the user, or null when allowed.
 */
export function blockedActionError(profile: Profile): string | null {
  if (profile.status !== "active") {
    return "Ihr Konto ist gesperrt. Diese Aktion ist derzeit nicht möglich.";
  }
  return null;
}
