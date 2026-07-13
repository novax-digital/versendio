import { describe, expect, it } from "vitest";
import { buildMusterPdf } from "@/lib/server/pdf/muster";
import { validateLetterPdf } from "@/lib/server/pdf/validate";

describe("buildMusterPdf", () => {
  it("the downloadable sample itself passes the upload validation", async () => {
    const bytes = await buildMusterPdf();
    const validation = await validateLetterPdf(bytes);
    expect(validation.pageCount).toBe(1);
    // No hard errors — especially no text inside the DVF blocked zone.
    expect(validation.rules.filter((r) => r.severity === "error")).toEqual([]);
  });
});
