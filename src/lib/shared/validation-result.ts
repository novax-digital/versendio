/** Result of a single PDF validation rule. */
export type RuleSeverity = "ok" | "warning" | "error";

export type ValidationRule = {
  id: string;
  severity: RuleSeverity;
  message: string;
};

export type ZoneResult = "ok" | "warning" | "fail";

export type PdfValidation = {
  pageCount: number | null;
  sheetCountSimplex: number | null;
  fileSizeBytes: number;
  isPdfA: boolean;
  addressZoneResult: ZoneResult;
  needsCoverLetter: boolean;
  rules: ValidationRule[];
};

export function worstSeverity(rules: ValidationRule[]): RuleSeverity {
  if (rules.some((r) => r.severity === "error")) return "error";
  if (rules.some((r) => r.severity === "warning")) return "warning";
  return "ok";
}

/** A letter is submittable only when no rule is an error. */
export function isSubmittable(validation: PdfValidation): boolean {
  return worstSeverity(validation.rules) !== "error";
}
