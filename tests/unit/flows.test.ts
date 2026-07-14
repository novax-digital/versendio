import { describe, expect, it } from "vitest";
import {
  computeScheduledSendAt,
  formatDelay,
  minutesToDelay,
  parseDelay,
} from "@/lib/shared/flows";

describe("parseDelay", () => {
  it("converts hours and days to whole minutes", () => {
    expect(parseDelay(24, "hours")).toBe(1440);
    expect(parseDelay(5, "days")).toBe(7200);
    expect(parseDelay(10, "days")).toBe(14400);
    expect(parseDelay(1, "hours")).toBe(60);
    expect(parseDelay(0, "days")).toBe(0);
  });

  it("rejects negative or non-finite values", () => {
    expect(() => parseDelay(-1, "days")).toThrow();
    expect(() => parseDelay(Number.NaN, "hours")).toThrow();
    expect(() => parseDelay(Infinity, "hours")).toThrow();
  });
});

describe("minutesToDelay / formatDelay", () => {
  it("prefers whole days, falls back to hours", () => {
    expect(minutesToDelay(7200)).toEqual({ value: 5, unit: "days" });
    expect(minutesToDelay(1440)).toEqual({ value: 1, unit: "days" });
    expect(minutesToDelay(60)).toEqual({ value: 1, unit: "hours" });
    expect(minutesToDelay(90)).toEqual({ value: 2, unit: "hours" }); // 1.5h → rounded
  });

  it("formats German singular/plural", () => {
    expect(formatDelay(1440)).toBe("1 Tag");
    expect(formatDelay(7200)).toBe("5 Tage");
    expect(formatDelay(60)).toBe("1 Stunde");
    expect(formatDelay(120)).toBe("2 Stunden");
  });
});

describe("computeScheduledSendAt", () => {
  it("adds exactly the delay interval", () => {
    const base = new Date("2026-07-14T10:00:00.000Z");
    expect(computeScheduledSendAt(base, 1440).toISOString()).toBe("2026-07-15T10:00:00.000Z");
    expect(computeScheduledSendAt(base, 0).toISOString()).toBe(base.toISOString());
  });

  it("rejects a negative or fractional delay", () => {
    const base = new Date("2026-07-14T10:00:00.000Z");
    expect(() => computeScheduledSendAt(base, -5)).toThrow();
    expect(() => computeScheduledSendAt(base, 1.5)).toThrow();
  });
});
