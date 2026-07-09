import { describe, expect, it } from "vitest";
import {
  isSubmittable,
  worstSeverity,
  type PdfValidation,
  type ValidationRule,
} from "@/lib/shared/validation-result";

const base = (rules: ValidationRule[]): PdfValidation => ({
  pageCount: 1,
  sheetCountSimplex: 1,
  fileSizeBytes: 1000,
  isPdfA: true,
  addressZoneResult: "ok",
  needsCoverLetter: false,
  rules,
});

describe("worstSeverity", () => {
  it("returns ok for no rules", () => {
    expect(worstSeverity([])).toBe("ok");
  });

  it("prefers error over warning", () => {
    expect(
      worstSeverity([
        { id: "a", severity: "warning", message: "" },
        { id: "b", severity: "error", message: "" },
      ]),
    ).toBe("error");
  });

  it("returns warning when no error present", () => {
    expect(worstSeverity([{ id: "a", severity: "warning", message: "" }])).toBe("warning");
  });
});

describe("isSubmittable", () => {
  it("allows a clean document", () => {
    expect(isSubmittable(base([]))).toBe(true);
  });

  it("allows warnings (PDF/A hint, cover-letter recommendation)", () => {
    expect(isSubmittable(base([{ id: "pdfa", severity: "warning", message: "" }]))).toBe(true);
  });

  it("blocks on any error (the gate that keeps bad PDFs from the carrier)", () => {
    expect(isSubmittable(base([{ id: "a4", severity: "error", message: "" }]))).toBe(false);
    expect(
      isSubmittable(
        base([
          { id: "pdfa", severity: "warning", message: "" },
          { id: "dvf_zone", severity: "error", message: "" },
        ]),
      ),
    ).toBe(false);
  });
});
