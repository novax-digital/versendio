"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, blockedActionError } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/server/rate-limit";
import {
  REVIEW_PLATFORMS,
  REVIEW_PLATFORM_KEYS,
  isPlausibleReviewUrl,
  type ReviewPlatform,
} from "@/lib/shared/review-rewards";
import type { ActionResult } from "@/lib/server/action-result";
import { de } from "@/lib/i18n/de";

const schema = z.object({
  platform: z.enum(REVIEW_PLATFORM_KEYS as [ReviewPlatform, ...ReviewPlatform[]]),
  url: z.string().trim().url().max(500),
});

/** Submits a review link for admin approval. Amount is snapshotted from constants. */
export async function submitReviewRewardAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const ip = await clientIp();
  if (!(await checkRateLimit("upload", `${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.credits.reviewUrlInvalid };

  if (!isPlausibleReviewUrl(parsed.data.platform, parsed.data.url)) {
    return { ok: false, error: de.credits.reviewUrlWrongPlatform };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("review_rewards").insert({
    user_id: profile.id,
    platform: parsed.data.platform,
    amount_cents: REVIEW_PLATFORMS[parsed.data.platform].amountCents,
    url: parsed.data.url,
  });
  if (error) {
    // Unique violation = an open request for this platform already exists.
    if (error.code === "23505") {
      return { ok: false, error: de.credits.reviewAlreadySubmitted };
    }
    console.error("review_reward_submit_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app/guthaben");
  return { ok: true };
}
