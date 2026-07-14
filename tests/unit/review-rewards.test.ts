import { describe, expect, it } from "vitest";
import {
  REVIEW_PLATFORMS,
  REVIEW_PLATFORM_KEYS,
  isPlausibleReviewUrl,
} from "@/lib/shared/review-rewards";

describe("review reward amounts", () => {
  it("snapshots the advertised amounts (integer cents)", () => {
    expect(REVIEW_PLATFORMS.trustpilot.amountCents).toBe(1500);
    expect(REVIEW_PLATFORMS.linkedin.amountCents).toBe(3000);
    for (const key of REVIEW_PLATFORM_KEYS) {
      expect(Number.isInteger(REVIEW_PLATFORMS[key].amountCents)).toBe(true);
      expect(REVIEW_PLATFORMS[key].amountCents).toBeGreaterThan(0);
    }
  });
});

describe("isPlausibleReviewUrl", () => {
  it("accepts matching hosts (incl. subdomains and localized TLDs)", () => {
    expect(isPlausibleReviewUrl("trustpilot", "https://www.trustpilot.com/review/versendio.de")).toBe(true);
    expect(isPlausibleReviewUrl("trustpilot", "https://de.trustpilot.com/reviews/abc")).toBe(true);
    expect(isPlausibleReviewUrl("linkedin", "https://www.linkedin.com/posts/max-123")).toBe(true);
  });

  it("rejects a link for the wrong platform", () => {
    expect(isPlausibleReviewUrl("trustpilot", "https://www.linkedin.com/posts/x")).toBe(false);
    expect(isPlausibleReviewUrl("linkedin", "https://www.trustpilot.com/review/x")).toBe(false);
  });

  it("rejects non-https schemes and malformed input", () => {
    expect(isPlausibleReviewUrl("trustpilot", "http://www.trustpilot.com/review/x")).toBe(false);
    expect(isPlausibleReviewUrl("trustpilot", "javascript:alert(1)")).toBe(false);
    expect(isPlausibleReviewUrl("trustpilot", "ftp://trustpilot.com/x")).toBe(false);
    expect(isPlausibleReviewUrl("trustpilot", "not a url")).toBe(false);
    expect(isPlausibleReviewUrl("trustpilot", "")).toBe(false);
  });

  it("rejects lookalike and userinfo host tricks", () => {
    expect(isPlausibleReviewUrl("trustpilot", "https://trustpilot.evil.com/x")).toBe(false);
    expect(isPlausibleReviewUrl("trustpilot", "https://mytrustpilot.com/x")).toBe(false);
    expect(isPlausibleReviewUrl("trustpilot", "https://trustpilot.com.evil.com/x")).toBe(false);
    expect(isPlausibleReviewUrl("trustpilot", "https://trustpilot.com@evil.com/x")).toBe(false);
  });

  it("is not fooled by the platform name appearing outside the host", () => {
    expect(isPlausibleReviewUrl("trustpilot", "https://evil.com/trustpilot.com")).toBe(false);
    expect(isPlausibleReviewUrl("linkedin", "https://evil.com/?x=linkedin.com")).toBe(false);
  });
});
