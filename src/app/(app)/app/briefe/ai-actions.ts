"use server";

import { z } from "zod";
import { blockedActionError, requireProfile } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server/env";
import { getJsonSetting, getNumberSetting } from "@/lib/server/settings";
import { checkCustomLimit, checkRateLimit } from "@/lib/server/rate-limit";
import { loadPricingRows } from "@/lib/server/pricing/load";
import { getDraftProvider, type DraftResult } from "@/lib/server/ai/draft-provider";
import { type ActionResult, fieldErrorsFromZod } from "@/lib/server/action-result";
import { de } from "@/lib/i18n/de";

/**
 * KI-Entwurf: generates a letter draft (subject + paragraphs) for the builder.
 *
 * Abuse protection (docs/ASSUMPTIONS.md A-009) — tokens cost real money and a
 * draft may never be sent, so generation is gated:
 *  1. Feature flag (env FEATURE_AI_DRAFTS) + admin kill switch (ai_drafts_enabled).
 *  2. Blocked accounts cannot generate.
 *  3. Credit gate: balance must cover at least one cheapest letter — only
 *     funded accounts can spend tokens (heuristic; no debit in v1).
 *  4. Per-minute rate limit (ai:<user>, fail-closed) + daily quota
 *     (ai_daily:<user>, limit from app_settings, atomic via check_rate_limit).
 *  5. Input caps; output is schema-validated and unknown {{tokens}} stripped.
 * Telemetry (lengths/tokens only — never content) goes to ai_draft_log.
 */

const draftInputSchema = z.object({
  anlass: z.string().min(3, de.validation.fieldRequired).max(600),
  stichpunkte: z.string().min(3, de.validation.fieldRequired).max(1200),
  tonalitaet: z.enum(["formell", "freundlich", "verbindlich"]).default("formell"),
  laenge: z.enum(["kurz", "mittel", "lang"]).default("mittel"),
});

export type GenerateDraftData = {
  betreff: string;
  absaetze: string[];
  provider: "anthropic" | "mock";
};

export async function generateLetterDraftAction(
  _prev: unknown,
  input: unknown,
): Promise<ActionResult<GenerateDraftData>> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const env = serverEnv();
  const enabled = env.FEATURE_AI_DRAFTS && (await getJsonSetting<boolean>("ai_drafts_enabled", true));
  if (!enabled) return { ok: false, error: de.letters.aiUnavailable };

  const parsed = draftInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: de.validation.fieldRequired, fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  // Credit gate: only funded accounts may spend tokens.
  try {
    const rows = await loadPricingRows();
    const basePrices = rows
      .filter((r) => r.kind === "tier" && r.active)
      .map((r) => r.vk_cents);
    const cheapest = basePrices.length > 0 ? Math.min(...basePrices) : 100;
    if (profile.credit_balance_cents < cheapest) {
      return { ok: false, error: de.letters.aiNeedsCredit };
    }
  } catch {
    return { ok: false, error: de.common.genericError };
  }

  // Burst + daily quota (both atomic in Postgres; fail closed).
  if (!(await checkRateLimit("ai", profile.id))) {
    return { ok: false, error: de.common.rateLimited };
  }
  const dailyLimit = await getNumberSetting("ai_daily_draft_limit", 10);
  if (dailyLimit <= 0) return { ok: false, error: de.letters.aiUnavailable };
  if (!(await checkCustomLimit(`ai_daily:${profile.id}`, dailyLimit, 86400, { failClosed: true }))) {
    return { ok: false, error: de.letters.aiDailyLimitReached };
  }

  const provider = getDraftProvider();
  let result: DraftResult;
  try {
    result = await provider.generateDraft(parsed.data);
  } catch (err) {
    // Never log prompt or output content — error class only.
    console.error("ai_draft_failed", {
      provider: provider.name,
      error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    });
    return { ok: false, error: de.letters.aiFailed };
  }

  const admin = createAdminClient();
  const { error: logError } = await admin.from("ai_draft_log").insert({
    user_id: profile.id,
    provider: provider.name,
    model: result.usage.model,
    input_chars: parsed.data.anlass.length + parsed.data.stichpunkte.length,
    output_chars: result.betreff.length + result.absaetze.join("").length,
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
  });
  if (logError) {
    console.error("ai_draft_log_failed", { error: logError.message });
  }

  return {
    ok: true,
    data: { betreff: result.betreff, absaetze: result.absaetze, provider: provider.name },
  };
}
