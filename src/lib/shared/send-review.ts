/**
 * Pure helpers for the admin send review (fraud incident 2026-10-28): when a
 * held job may be submitted, and warning heuristics that RANK jobs for the
 * reviewing admin — nothing is blocked automatically. No I/O, unit-testable;
 * texts live in de.ts.
 *
 * Lesson from the incident: the phishing letter was a single full-page image
 * (no extractable text), so keyword matching alone would have missed it. The
 * strong signals were the sender (a bank's name and address) not matching the
 * account, and a brand-new account mailing 192 recipients at once.
 */
import { z } from "zod";

export const REVIEW_FLAG_CODES = [
  "content_changed",
  "sender_brand",
  "sender_mismatch",
  "image_only",
  "text_unchecked",
  "phishing_terms",
  "brand_terms",
  "bulk_first_job",
  "first_job",
  "new_account",
] as const;

export type ReviewFlagCode = (typeof REVIEW_FLAG_CODES)[number];

export type ReviewFlag = {
  code: ReviewFlagCode;
  level: "high" | "info";
  /** Matched terms, names or counts, for display only. */
  detail?: string;
};

/** Shape of send_jobs.review_flags (jsonb) — validated when read back. */
export const reviewFlagsSchema = z.array(
  z.object({
    code: z.enum(REVIEW_FLAG_CODES),
    level: z.enum(["high", "info"]),
    detail: z.string().optional(),
  }),
);

/**
 * When a submit attempt must wait instead of going to the provider: the end
 * of an unreleased review hold or the customer's own scheduled release,
 * whichever is later. Null = may submit now.
 */
export function reviewDeferUntil(
  job: {
    review_hold_until: string | null;
    review_released_at: string | null;
    scheduled_release_at: string | null;
  },
  now: number,
): string | null {
  const candidates: string[] = [];
  if (job.review_hold_until && !job.review_released_at && Date.parse(job.review_hold_until) > now) {
    candidates.push(job.review_hold_until);
  }
  if (job.scheduled_release_at && Date.parse(job.scheduled_release_at) > now) {
    candidates.push(job.scheduled_release_at);
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

export type ReviewInput = {
  sender: { company?: string | null; firstName?: string | null; lastName?: string | null };
  accountCompany: string | null;
  accountCreatedAt: Date;
  now: Date;
  /** Completed paid jobs of this account (canceled/held ones don't count). */
  completedJobs: number;
  /** Recipients across all of the account's open jobs, this one included. */
  openRecipients: number;
  letterTitle: string;
  /** Extracted letter text; null when extraction failed. */
  letterText: string | null;
  /** Pages the text was extracted from (cover letter excluded). */
  contentPages: number;
  /** The content changed after a previous review (restart). */
  contentChanged: boolean;
};

// Brands and authorities commonly impersonated in German phishing mail.
// Normalized form (see normalize()); multi-word terms match as phrases.
const BRAND_TERMS = [
  "apobank", "apo bank", "aerztebank", "sparkasse", "volksbank", "raiffeisen",
  "vr bank", "deutsche bank", "commerzbank", "postbank", "ing diba", "dkb",
  "comdirect", "consorsbank", "targobank", "hypovereinsbank", "unicredit", "n26",
  "santander", "sparda", "psd bank", "norisbank", "landesbank", "bundesbank",
  "paypal", "amazon", "klarna", "apple", "microsoft", "netflix", "ebay", "dhl",
  "mastercard", "visa", "american express", "schufa", "bafin", "finanzamt",
  "bundeszentralamt", "bundesagentur", "rentenversicherung", "bundeskriminalamt",
  "polizei", "europol", "telekom", "vodafone", "krankenkasse", "aok", "barmer",
];

const PHISHING_TERMS = [
  "verifizierung", "verifizieren", "legitimation", "legitimieren", "tan",
  "pushtan", "phototan", "apotan", "smarttan", "chiptan", "qr code", "qrcode",
  "online banking", "onlinebanking", "zugangsdaten", "kontosperrung", "sperrung",
  "deaktiviert", "sicherheitsupdate", "sicherheitsverfahren", "datenabgleich",
];

// Legal-form and filler tokens that must not count as a name overlap.
const COMPANY_NOISE = new Set([
  "gmbh", "mbh", "ug", "ag", "eg", "kg", "ohg", "gbr", "ek", "ev", "co", "und",
  "haftungsbeschraenkt", "se", "ltd", "inc", "partg", "kgaa",
]);

const MIN_CHARS_PER_PAGE = 200;
const BULK_FIRST_JOB = 50;
const NEW_ACCOUNT_DAYS = 14;

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Terms found in `text`. Short terms (< 6 chars: "tan", "dkb", "visa") must
 * match whole words to avoid hits inside ordinary words; longer ones also
 * match inside compounds ("Stadtsparkasse").
 */
export function findTerms(text: string, terms: readonly string[]): string[] {
  const haystack = ` ${normalize(text)} `;
  return terms.filter((term) =>
    term.length >= 6 ? haystack.includes(term) : haystack.includes(` ${term} `),
  );
}

function companyTokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((t) => t.length >= 3 && !COMPANY_NOISE.has(t)),
  );
}

/** True when the sender company shares no significant word with the account's. */
export function senderMismatch(senderCompany: string, accountCompany: string | null): boolean {
  if (!accountCompany?.trim()) return true;
  const account = companyTokens(accountCompany);
  return ![...companyTokens(senderCompany)].some((t) => account.has(t));
}

export function computeReviewFlags(input: ReviewInput): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  if (input.contentChanged) flags.push({ code: "content_changed", level: "high" });

  // Company and name only — street names like "Sparkassenstraße" must not fire.
  const senderCompany = input.sender.company?.trim() ?? "";
  const senderText = [senderCompany, input.sender.firstName, input.sender.lastName]
    .filter(Boolean)
    .join(" ");
  const senderBrands = findTerms(senderText, BRAND_TERMS);
  if (senderBrands.length > 0) {
    flags.push({ code: "sender_brand", level: "high", detail: senderBrands.join(", ") });
  }
  if (senderCompany && senderMismatch(senderCompany, input.accountCompany)) {
    // Many legit accounts leave the company empty — only a real conflict is high.
    flags.push({
      code: "sender_mismatch",
      level: input.accountCompany?.trim() ? "high" : "info",
      detail: `${senderCompany} ≠ ${input.accountCompany?.trim() || "–"}`,
    });
  }

  if (input.letterText === null) {
    flags.push({ code: "text_unchecked", level: "info" });
  } else {
    const chars = input.letterText.replace(/\s+/g, "").length;
    if (input.contentPages > 0 && chars / input.contentPages < MIN_CHARS_PER_PAGE) {
      flags.push({ code: "image_only", level: "high", detail: String(chars) });
    }
  }

  const content = `${input.letterTitle} ${input.letterText ?? ""}`;
  const phishing = findTerms(content, PHISHING_TERMS);
  if (phishing.length > 0) {
    // One term ("QR-Code") is common in legit marketing; several together are not.
    flags.push({
      code: "phishing_terms",
      level: phishing.length >= 2 ? "high" : "info",
      detail: phishing.join(", "),
    });
  }
  const brands = findTerms(content, BRAND_TERMS);
  if (brands.length > 0) {
    // Bank names routinely appear in footers (Bankverbindung) — hint only.
    flags.push({ code: "brand_terms", level: "info", detail: brands.join(", ") });
  }

  if (input.completedJobs === 0) {
    // Summed over open jobs, so splitting 192 letters into 4×48 doesn't hide it.
    flags.push(
      input.openRecipients >= BULK_FIRST_JOB
        ? { code: "bulk_first_job", level: "high", detail: String(input.openRecipients) }
        : { code: "first_job", level: "info" },
    );
  }
  const ageDays = Math.floor(
    (input.now.getTime() - input.accountCreatedAt.getTime()) / 86_400_000,
  );
  if (ageDays < NEW_ACCOUNT_DAYS) {
    flags.push({ code: "new_account", level: "info", detail: String(Math.max(ageDays, 0)) });
  }

  // High first, so the mail and the console lead with what matters.
  return flags.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1));
}
