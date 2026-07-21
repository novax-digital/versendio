import { describe, expect, it } from "vitest";
import {
  templateAllowed,
  formatStatusDigest,
  DEFAULT_NOTIFICATION_PREFS,
} from "@/lib/shared/notifications";

describe("templateAllowed", () => {
  it("sends everything under default prefs", () => {
    for (const t of [
      "job_completed",
      "job_completed_with_errors",
      "job_status_update",
      "topup_confirmed",
      "flow_summary",
      "items_on_hold",
      "welcome",
    ]) {
      expect(templateAllowed(t, DEFAULT_NOTIFICATION_PREFS)).toBe(true);
    }
  });

  it("suppresses gated templates when their pref is off", () => {
    expect(templateAllowed("job_completed", { notify_send_status: false })).toBe(false);
    expect(templateAllowed("job_completed_with_errors", { notify_send_status: false })).toBe(false);
    expect(templateAllowed("job_status_update", { notify_epost_updates: false })).toBe(false);
    expect(templateAllowed("topup_confirmed", { notify_topup: false })).toBe(false);
    expect(templateAllowed("flow_summary", { notify_flow_activity: false })).toBe(false);
  });

  it("never suppresses account/action-critical templates", () => {
    const allOff = {
      notify_send_status: false,
      notify_epost_updates: false,
      notify_topup: false,
      notify_flow_activity: false,
    };
    expect(templateAllowed("items_on_hold", allOff)).toBe(true);
    expect(templateAllowed("welcome", allOff)).toBe(true);
    // Unknown templates default to send (opt-outable only by explicit listing).
    expect(templateAllowed("future_template", allOff)).toBe(true);
  });

  it("treats missing/null columns as the opt-out default (send)", () => {
    expect(templateAllowed("job_completed", null)).toBe(true);
    expect(templateAllowed("job_completed", {})).toBe(true);
    expect(templateAllowed("topup_confirmed", { notify_topup: null })).toBe(true);
  });
});

describe("formatStatusDigest", () => {
  const labels = {
    accepted: "Angenommen",
    checked: "Geprüft",
    print_center: "Im Druckzentrum",
    sent: "Versendet",
  };

  it("formats singular and plural lines in label order", () => {
    const lines = formatStatusDigest({ sent: 3, print_center: 1 }, labels);
    expect(lines).toEqual([
      "1 Brief ist jetzt: Im Druckzentrum",
      "3 Briefe sind jetzt: Versendet",
    ]);
  });

  it("keeps unknown statuses instead of dropping counts", () => {
    const lines = formatStatusDigest({ weird_status: 2 }, labels);
    expect(lines).toEqual(["2 Briefe sind jetzt: weird_status"]);
  });

  it("skips zero/negative counts and handles empty input", () => {
    expect(formatStatusDigest({}, labels)).toEqual([]);
    expect(formatStatusDigest({ sent: 0 }, labels)).toEqual([]);
  });
});
