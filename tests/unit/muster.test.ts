import { describe, expect, it } from "vitest";
import { buildMusterPdf } from "@/lib/server/pdf/muster";
import { validateLetterPdf } from "@/lib/server/pdf/validate";

describe("buildMusterPdf", () => {
  it("the sample is rejected on upload with the dedicated muster rule only", async () => {
    const bytes = await buildMusterPdf();
    const validation = await validateLetterPdf(bytes);
    expect(validation.pageCount).toBe(1);
    // The keyword marker fails the sample fast (its zone illustrations are
    // vector ink the carrier would refuse); no OTHER hard error may fire —
    // especially no text inside the DVF blocked zone.
    const errors = validation.rules.filter((r) => r.severity === "error");
    expect(errors.map((r) => r.id)).toEqual(["muster_sample"]);
  });
});
