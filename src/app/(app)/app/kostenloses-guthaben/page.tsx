import type { Metadata } from "next";
import { UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { de } from "@/lib/i18n/de";
import { ReviewRewardsSection, type RewardRequest } from "./review-rewards-section";

export const metadata: Metadata = { title: de.credits.freeCreditTitle };

export default async function FreeCreditPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: rewardRequests } = await supabase
    .from("review_rewards")
    .select("platform, status")
    .eq("user_id", profile.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{de.credits.freeCreditTitle}</h1>
        <p className="text-muted-foreground text-sm">{de.credits.freeCreditSubtitle}</p>
      </div>

      <ReviewRewardsSection requests={(rewardRequests ?? []) as RewardRequest[]} />

      {/* Refer-a-friend teaser — feature not built yet, shown to gauge interest. */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="text-primary size-4" aria-hidden />
            {de.credits.referTitle}
            <Badge variant="secondary" className="ml-1 font-normal">
              {de.credits.comingSoon}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{de.credits.referTeaser}</p>
        </CardContent>
      </Card>
    </div>
  );
}
