/**
 * Credit rewards for public reviews. The amount is snapshotted onto each
 * request row at submission, so changing these constants never re-prices a
 * pending or approved request. All amounts integer cents.
 *
 * Money is server-authoritative: the DB trigger enforce_review_reward_insert
 * (migration 20260714150000) forces amount_cents from the platform, so these
 * values are for display only. Keep the two in sync when changing a reward.
 */
export type ReviewPlatform = "trustpilot" | "linkedin";

export const REVIEW_PLATFORMS: Record<
  ReviewPlatform,
  { label: string; amountCents: number; host: string; actionLabel: string }
> = {
  trustpilot: {
    label: "Trustpilot-Bewertung",
    amountCents: 1500,
    host: "trustpilot.com",
    actionLabel: "Bewertung schreiben",
  },
  linkedin: {
    label: "LinkedIn-Erfahrungsbericht",
    amountCents: 3000,
    host: "linkedin.com",
    actionLabel: "Beitrag verfassen",
  },
};

export const REVIEW_PLATFORM_KEYS = Object.keys(REVIEW_PLATFORMS) as ReviewPlatform[];

/**
 * True if the URL is an https link on the platform's own domain. Uses an exact
 * host / subdomain-of match (never a substring), so `trustpilot.evil.com` or
 * `https://evil.com/trustpilot.com` are rejected. The DB trigger
 * enforce_review_reward_insert applies the same rule for direct inserts.
 */
export function isPlausibleReviewUrl(platform: ReviewPlatform, url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    const base = REVIEW_PLATFORMS[platform].host;
    return host === base || host.endsWith(`.${base}`);
  } catch {
    return false;
  }
}
