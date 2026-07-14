"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Gift } from "lucide-react";
import { submitReviewRewardAction } from "./review-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents } from "@/lib/shared/money";
import {
  REVIEW_PLATFORM_KEYS,
  REVIEW_PLATFORMS,
  type ReviewPlatform,
} from "@/lib/shared/review-rewards";
import { de } from "@/lib/i18n/de";

export type RewardRequest = { platform: ReviewPlatform; status: "pending" | "approved" | "rejected" };

const PLATFORM_LINKS: Record<ReviewPlatform, string> = {
  trustpilot: "https://www.trustpilot.com/evaluate/versendio.de",
  linkedin: "https://www.linkedin.com/feed/",
};

export function ReviewRewardsSection({ requests }: { requests: RewardRequest[] }) {
  const byPlatform = new Map(requests.map((r) => [r.platform, r.status]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="text-primary size-4" aria-hidden />
          {de.credits.rewardsTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">{de.credits.rewardsHint}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {REVIEW_PLATFORM_KEYS.map((platform) => (
            <RewardCard
              key={platform}
              platform={platform}
              status={byPlatform.get(platform) ?? null}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function statusBadge(status: "pending" | "approved" | "rejected") {
  if (status === "pending")
    return (
      <Badge variant="outline" className="border-warning text-warning">
        {de.credits.rewardStatusPending}
      </Badge>
    );
  if (status === "approved")
    return (
      <Badge variant="outline" className="border-success text-success">
        {de.credits.rewardStatusApproved}
      </Badge>
    );
  return <Badge variant="secondary">{de.credits.rewardStatusRejected}</Badge>;
}

function RewardCard({
  platform,
  status,
}: {
  platform: ReviewPlatform;
  status: "pending" | "approved" | "rejected" | null;
}) {
  const meta = REVIEW_PLATFORMS[platform];
  const [showForm, setShowForm] = useState(false);
  const [state, formAction, pending] = useActionState(submitReviewRewardAction, null);

  // Toast on result. On success the parent re-renders this card as `locked`
  // (revalidated status becomes "pending"), which hides the form on its own.
  useEffect(() => {
    if (state?.ok) {
      toast.success(de.credits.reviewSubmitted);
    } else if (state && !state.ok && state.error) {
      toast.error(state.error);
    }
  }, [state]);

  // Pending or approved requests are terminal for the card; rejected can retry.
  const locked = status === "pending" || status === "approved";

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{meta.label}</p>
          <p className="text-primary text-sm font-semibold">
            {de.credits.rewardEarn(formatCents(meta.amountCents))}
          </p>
        </div>
        {status ? statusBadge(status) : null}
      </div>

      {locked ? null : showForm ? (
        <form action={formAction} className="space-y-2" key={platform}>
          <input type="hidden" name="platform" value={platform} />
          <div className="space-y-1">
            <Label htmlFor={`url-${platform}`} className="text-xs">
              {de.credits.rewardUrlLabel}
            </Label>
            <Input
              id={`url-${platform}`}
              name="url"
              type="url"
              required
              placeholder="https://…"
            />
          </div>
          <Button type="submit" size="sm" className="w-full" disabled={pending}>
            {pending ? de.common.saving : de.credits.rewardSubmit}
          </Button>
        </form>
      ) : (
        <div className="mt-auto flex flex-wrap gap-2">
          <a
            href={PLATFORM_LINKS[platform]}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            {meta.actionLabel}
          </a>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setShowForm(true)}>
            {de.credits.rewardSubmitLink}
          </Button>
        </div>
      )}
    </div>
  );
}
