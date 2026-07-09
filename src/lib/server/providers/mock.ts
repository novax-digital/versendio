import "server-only";
import { createHash, randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNumberSetting } from "@/lib/server/settings";
import type {
  LetterProvider,
  ProviderItemStatus,
  ProviderStatusInfo,
  SubmitLetterInput,
  SubmitLetterResult,
} from "./types";

/**
 * Fully functional mock carrier (ADR-0005 §3). Simulates the real E-Post
 * status model 1→2→3→4 (time-shifted, configurable step) with a configurable
 * random failure rate; deterministic failure via recipient marker "FAIL"
 * (city or address line) for QA. State lives in the DB (mock_letters payloads
 * inside app_settings would be too hacky — we reuse send_job_items' own
 * provider fields plus time-based derivation, so the mock is stateless).
 *
 * Status derivation: from submitted_at + step minutes; failures decided at
 * submit time via a stable hash so re-polls are consistent.
 */

function isForcedFailure(input: Pick<SubmitLetterInput, "addressLines" | "city">): boolean {
  const haystack = [input.city, ...input.addressLines].join(" ").toUpperCase();
  return haystack.includes("FAIL");
}

function stableFailRoll(providerLetterId: string, failPercent: number): boolean {
  // Same letter id → same decision on every poll.
  const h = createHash("sha256").update(providerLetterId).digest();
  return (h[0] * 256 + h[1]) % 10000 < failPercent * 100;
}

function statusFromAge(ageMinutes: number, stepMinutes: number): ProviderItemStatus {
  if (ageMinutes < stepMinutes) return "accepted";
  if (ageMinutes < stepMinutes * 2) return "checked";
  if (ageMinutes < stepMinutes * 3) return "print_center";
  return "sent";
}

const STATUS_IDS: Record<ProviderItemStatus, number> = {
  accepted: 1,
  checked: 2,
  print_center: 3,
  sent: 4,
  failed: 99,
};

function toInfo(
  providerLetterId: string,
  status: ProviderItemStatus,
  custom1: string | null,
): ProviderStatusInfo {
  return {
    providerLetterId,
    status,
    providerStatusId: STATUS_IDS[status],
    details: status === "failed" ? "Simulierter Fehler (Mock)" : `Mock-Status ${STATUS_IDS[status]}`,
    frankierId: status === "sent" ? `MOCKFRK${providerLetterId.slice(-6)}` : null,
    destinationAreaStatus: status === "sent" ? "Im Zielgebiet angekommen (Mock)" : null,
    destinationAreaStatusDate: status === "sent" ? new Date().toISOString() : null,
    registeredStatus: null,
    custom1,
    errorCode: status === "failed" ? "MOCK99" : null,
    errorMessage: status === "failed" ? "Simulierter Zustellfehler (Mock-Modus)" : null,
  };
}

async function deriveStatus(
  providerLetterId: string,
  submittedAt: string | null,
  failPercent: number,
  stepMinutes: number,
  forcedFail: boolean,
): Promise<ProviderItemStatus> {
  if (forcedFail || stableFailRoll(providerLetterId, failPercent)) {
    // Failures surface after the first step (like a real check failure).
    const age = submittedAt ? (Date.now() - Date.parse(submittedAt)) / 60000 : 0;
    return age >= stepMinutes ? "failed" : "accepted";
  }
  const age = submittedAt ? (Date.now() - Date.parse(submittedAt)) / 60000 : 0;
  return statusFromAge(age, stepMinutes);
}

export class MockProvider implements LetterProvider {
  readonly name = "mock" as const;

  async submitLetter(input: SubmitLetterInput): Promise<SubmitLetterResult> {
    // Fake id, prefixed for visibility; forced-failure marker encoded in the id.
    const forced = isForcedFailure(input) ? "F" : "N";
    const id = `MOCK-${forced}-${Date.now()}-${randomInt(1_000_000)}`;
    return { providerLetterId: id };
  }

  async getStatus(providerLetterId: string): Promise<ProviderStatusInfo | null> {
    const item = await this.loadItem(providerLetterId);
    if (!item) return null;
    const [failPercent, stepMinutes] = await Promise.all([
      getNumberSetting("mock_fail_percent", 2),
      getNumberSetting("mock_status_step_minutes", 2),
    ]);
    const status = await deriveStatus(
      providerLetterId,
      item.submitted_at,
      failPercent,
      stepMinutes,
      providerLetterId.startsWith("MOCK-F-"),
    );
    return toInfo(providerLetterId, status, item.id);
  }

  async listOpenLetters(): Promise<ProviderStatusInfo[]> {
    const admin = createAdminClient();
    const { data } = await admin
      .from("send_job_items")
      .select("id, provider_letter_id, submitted_at")
      .eq("provider", "mock")
      .in("status", ["submitted", "accepted", "checked", "print_center"])
      .limit(500);
    const [failPercent, stepMinutes] = await Promise.all([
      getNumberSetting("mock_fail_percent", 2),
      getNumberSetting("mock_status_step_minutes", 2),
    ]);
    const results: ProviderStatusInfo[] = [];
    for (const item of data ?? []) {
      if (!item.provider_letter_id) continue;
      const status = await deriveStatus(
        item.provider_letter_id,
        item.submitted_at,
        failPercent,
        stepMinutes,
        item.provider_letter_id.startsWith("MOCK-F-"),
      );
      results.push(toInfo(item.provider_letter_id, status, item.id));
    }
    return results;
  }

  async findByItemId(itemId: string): Promise<ProviderStatusInfo | null> {
    const admin = createAdminClient();
    const { data } = await admin
      .from("send_job_items")
      .select("id, provider_letter_id, submitted_at")
      .eq("id", itemId)
      .maybeSingle();
    if (!data?.provider_letter_id) return null;
    return this.getStatus(data.provider_letter_id);
  }

  async getTestResult(): Promise<Uint8Array | null> {
    // The wizard's own preview PDF stands in for the provider proof.
    return null;
  }

  async cancelQueued(): Promise<boolean> {
    return true;
  }

  async releaseQueued(): Promise<boolean> {
    return true;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string | null }> {
    return { ok: true, message: "Mock-Modus aktiv — kein echter Versand." };
  }

  private async loadItem(providerLetterId: string) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("send_job_items")
      .select("id, submitted_at")
      .eq("provider_letter_id", providerLetterId)
      .maybeSingle();
    return data;
  }
}
