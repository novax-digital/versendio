import { describe, expect, it } from "vitest";

/**
 * Mirrors businessBoundaries() in src/lib/server/admin/queries.ts. Kept as a
 * standalone copy because the module pulls in the service-role Supabase client.
 * If the implementation changes, this test must change with it.
 */
const BUSINESS_TZ = "Europe/Berlin";

function businessBoundaries(now: Date): { dayStart: string; monthStart: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const year = get("year");
  const month = get("month");
  const day = get("day");

  const toInstant = (isoLocal: string): string => {
    const guess = new Date(`${isoLocal}Z`);
    const asZoned = new Date(guess.toLocaleString("en-US", { timeZone: BUSINESS_TZ }));
    const asUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
    const offsetMs = asZoned.getTime() - asUtc.getTime();
    return new Date(guess.getTime() - offsetMs).toISOString();
  };

  return {
    dayStart: toInstant(`${year}-${month}-${day}T00:00:00`),
    monthStart: toInstant(`${year}-${month}-01T00:00:00`),
  };
}

describe("businessBoundaries (Europe/Berlin)", () => {
  it("resolves midnight during CEST (UTC+2) to 22:00 UTC the previous day", () => {
    // 2026-07-09 12:00 UTC → Berlin summer time
    const { dayStart, monthStart } = businessBoundaries(new Date("2026-07-09T12:00:00Z"));
    expect(dayStart).toBe("2026-07-08T22:00:00.000Z");
    expect(monthStart).toBe("2026-06-30T22:00:00.000Z");
  });

  it("resolves midnight during CET (UTC+1) to 23:00 UTC the previous day", () => {
    const { dayStart, monthStart } = businessBoundaries(new Date("2026-01-15T12:00:00Z"));
    expect(dayStart).toBe("2026-01-14T23:00:00.000Z");
    expect(monthStart).toBe("2025-12-31T23:00:00.000Z");
  });

  it("uses the Berlin calendar day, not the UTC day, just after local midnight", () => {
    // 2026-07-09 22:30 UTC is already 2026-07-10 00:30 in Berlin.
    const { dayStart } = businessBoundaries(new Date("2026-07-09T22:30:00Z"));
    expect(dayStart).toBe("2026-07-09T22:00:00.000Z"); // start of Berlin's 10 July
  });
});
