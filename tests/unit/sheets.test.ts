import { describe, expect, it } from "vitest";
import { sheetsFromPages } from "@/lib/shared/sheets";

describe("sheetsFromPages", () => {
  it("equals page count for simplex", () => {
    expect(sheetsFromPages(1, false)).toBe(1);
    expect(sheetsFromPages(5, false)).toBe(5);
  });

  it("halves rounded up for duplex", () => {
    expect(sheetsFromPages(1, true)).toBe(1);
    expect(sheetsFromPages(2, true)).toBe(1);
    expect(sheetsFromPages(3, true)).toBe(2);
    expect(sheetsFromPages(10, true)).toBe(5);
  });

  it("returns 0 for no pages", () => {
    expect(sheetsFromPages(0, false)).toBe(0);
    expect(sheetsFromPages(-3, true)).toBe(0);
  });
});
