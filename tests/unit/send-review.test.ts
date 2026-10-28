import { describe, expect, it } from "vitest";
import {
  computeReviewFlags,
  findTerms,
  normalize,
  reviewDeferUntil,
  reviewFlagsSchema,
  senderMismatch,
  type ReviewInput,
} from "@/lib/shared/send-review";

const NOW = new Date("2026-10-28T08:00:00Z");

function input(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    sender: { company: "Müller Haustechnik GmbH" },
    accountCompany: "Müller Haustechnik GmbH",
    accountCreatedAt: new Date("2025-01-01T00:00:00Z"),
    now: NOW,
    completedJobs: 12,
    openRecipients: 40,
    letterTitle: "Wartungserinnerung",
    letterText: "Sehr geehrte Damen und Herren, ".repeat(20),
    contentPages: 1,
    contentChanged: false,
    ...overrides,
  };
}

const codes = (i: ReviewInput) => computeReviewFlags(i).map((f) => f.code);

describe("normalize / findTerms", () => {
  it("folds umlauts, case and punctuation", () => {
    expect(normalize("Ärztebank – QR-Code!")).toBe("aerztebank qr code");
  });

  it("matches short terms only as whole words", () => {
    expect(findTerms("Bitte TAN eingeben", ["tan"])).toEqual(["tan"]);
    expect(findTerms("Die Tanne im Garten", ["tan"])).toEqual([]);
  });

  it("matches long terms inside compounds", () => {
    expect(findTerms("Stadtsparkasse Köln", ["sparkasse"])).toEqual(["sparkasse"]);
  });
});

describe("senderMismatch", () => {
  it("ignores legal forms and accepts a shared significant word", () => {
    expect(senderMismatch("Müller Haustechnik GmbH", "Haustechnik Müller e.K.")).toBe(false);
  });

  it("flags an unrelated company or an empty account company", () => {
    expect(senderMismatch("apoBank eG", "Handwerk Schmidt GmbH")).toBe(true);
    expect(senderMismatch("apoBank eG", null)).toBe(true);
    expect(senderMismatch("Beta GmbH", "GmbH")).toBe(true);
  });
});

describe("computeReviewFlags", () => {
  it("raises nothing for an established customer's ordinary letter", () => {
    expect(computeReviewFlags(input())).toEqual([]);
  });

  it("catches the 2026-10-28 apoBank job (image-only, bank sender, new account)", () => {
    const flags = computeReviewFlags(
      input({
        sender: { company: "apoBank eG" },
        accountCompany: null,
        accountCreatedAt: new Date("2026-10-24T10:00:00Z"),
        completedJobs: 0,
        openRecipients: 192,
        letterTitle: "kampagne-43884534935",
        letterText: "28.10.2026",
        contentPages: 1,
      }),
    );
    const high = flags.filter((f) => f.level === "high").map((f) => f.code);
    expect(high).toEqual(expect.arrayContaining(["sender_brand", "image_only", "bulk_first_job"]));
    expect(flags.find((f) => f.code === "new_account")?.detail).toBe("3");
    // High flags come first.
    expect(flags[0].level).toBe("high");
  });

  it("rates a sender mismatch high only against a real account company", () => {
    const conflict = computeReviewFlags(input({ sender: { company: "Beta Handel GmbH" } }));
    expect(conflict.find((f) => f.code === "sender_mismatch")?.level).toBe("high");

    const noCompany = computeReviewFlags(
      input({ sender: { company: "Beta Handel GmbH" }, accountCompany: null }),
    );
    expect(noCompany.find((f) => f.code === "sender_mismatch")?.level).toBe("info");
  });

  it("does not read brands out of a sender's street (only company and name)", () => {
    expect(codes(input({ sender: { company: "Müller Haustechnik GmbH", lastName: null } }))).toEqual([]);
  });

  it("puts a content change after review first", () => {
    expect(computeReviewFlags(input({ contentChanged: true }))[0]).toEqual({
      code: "content_changed",
      level: "high",
    });
  });

  it("treats one phishing term as a hint and several as a warning", () => {
    const one = computeReviewFlags(input({ letterText: `${"Text ".repeat(60)} QR-Code` }));
    expect(one.find((f) => f.code === "phishing_terms")?.level).toBe("info");

    const many = computeReviewFlags(
      input({ letterText: `${"Text ".repeat(60)} Verifizierung Ihrer Zugangsdaten per pushTAN` }),
    );
    expect(many.find((f) => f.code === "phishing_terms")?.level).toBe("high");
  });

  it("only hints at bank names in the body (footers carry the Bankverbindung)", () => {
    const flags = computeReviewFlags(
      input({ letterText: `${"Text ".repeat(60)} Bankverbindung: Sparkasse KölnBonn` }),
    );
    expect(flags).toEqual([{ code: "brand_terms", level: "info", detail: "sparkasse" }]);
  });

  it("reports unchecked text instead of guessing when extraction failed", () => {
    expect(codes(input({ letterText: null }))).toEqual(["text_unchecked"]);
  });

  it("does not compare companies for a private-person sender", () => {
    expect(
      codes(input({ sender: { company: null, firstName: "Max", lastName: "Muster" }, accountCompany: null })),
    ).toEqual([]);
  });

  it("sums open recipients so splitting a bulk first send does not hide it", () => {
    expect(codes(input({ completedJobs: 0, openRecipients: 3 }))).toEqual(["first_job"]);
    expect(codes(input({ completedJobs: 0, openRecipients: 4 * 48 }))).toEqual(["bulk_first_job"]);
  });

  it("produces flags that round-trip through the stored jsonb schema", () => {
    const flags = computeReviewFlags(input({ contentChanged: true, letterText: null }));
    expect(reviewFlagsSchema.parse(JSON.parse(JSON.stringify(flags)))).toEqual(flags);
  });
});

describe("reviewDeferUntil", () => {
  const now = Date.parse("2026-10-28T08:00:00Z");
  const base = { review_hold_until: null, review_released_at: null, scheduled_release_at: null };

  it("lets a job without hold or schedule go now", () => {
    expect(reviewDeferUntil(base, now)).toBeNull();
  });

  it("waits for an unreleased hold, not for an expired or released one", () => {
    const hold = "2026-10-28T16:00:00Z";
    expect(reviewDeferUntil({ ...base, review_hold_until: hold }, now)).toBe(hold);
    expect(reviewDeferUntil({ ...base, review_hold_until: "2026-10-28T07:00:00Z" }, now)).toBeNull();
    expect(
      reviewDeferUntil({ ...base, review_hold_until: hold, review_released_at: "2026-10-28T07:30:00Z" }, now),
    ).toBeNull();
  });

  it("never goes before the customer's own schedule, even after a release", () => {
    const schedule = "2026-10-30T09:00:00Z";
    expect(
      reviewDeferUntil(
        {
          review_hold_until: "2026-10-28T16:00:00Z",
          review_released_at: "2026-10-28T07:30:00Z",
          scheduled_release_at: schedule,
        },
        now,
      ),
    ).toBe(schedule);
    expect(
      reviewDeferUntil(
        { ...base, review_hold_until: "2026-10-28T16:00:00Z", scheduled_release_at: schedule },
        now,
      ),
    ).toBe(schedule);
  });
});
