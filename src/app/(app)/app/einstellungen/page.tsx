import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { de } from "@/lib/i18n/de";
import { ProfileForm } from "./profile-form";
import { CoverFooterForm } from "./cover-footer-form";

export const metadata: Metadata = { title: de.profile.title };

export default async function ProfileSettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: pref } = await supabase
    .from("profiles")
    .select("cover_letter_footer")
    .eq("id", profile.id)
    .maybeSingle();

  return (
    <div className="max-w-xl space-y-2">
      <p className="text-muted-foreground text-sm">{de.profile.subtitle}</p>
      <ProfileForm
        defaults={{
          displayName: profile.display_name ?? "",
          company: profile.company ?? "",
          billingStreet: profile.billing_street ?? "",
          billingZip: profile.billing_zip ?? "",
          billingCity: profile.billing_city ?? "",
          billingCountry: profile.billing_country ?? "DE",
        }}
      />
      <CoverFooterForm defaultEnabled={pref?.cover_letter_footer ?? true} />
    </div>
  );
}
