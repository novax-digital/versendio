import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { PdfValidation, RuleSeverity } from "@/lib/shared/validation-result";
import { de } from "@/lib/i18n/de";

const icons: Record<RuleSeverity, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

const colors: Record<RuleSeverity, string> = {
  ok: "text-emerald-600",
  warning: "text-amber-600",
  error: "text-destructive",
};

/** Lists PDF validation findings with per-rule severity. */
export function ValidationReport({ validation }: { validation: PdfValidation }) {
  const hasError = validation.rules.some((r) => r.severity === "error");
  const hasWarning = validation.rules.some((r) => r.severity === "warning");
  const summary = hasError
    ? de.letters.validationFailed
    : hasWarning
      ? de.letters.validationWarnings
      : de.letters.validationOk;
  const summarySeverity: RuleSeverity = hasError ? "error" : hasWarning ? "warning" : "ok";
  const SummaryIcon = icons[summarySeverity];

  return (
    <div className="space-y-3">
      <p className={`flex items-center gap-2 text-sm font-medium ${colors[summarySeverity]}`}>
        <SummaryIcon className="size-4" aria-hidden />
        {summary}
      </p>
      {validation.rules.length > 0 ? (
        <ul className="space-y-2">
          {validation.rules.map((rule) => {
            const Icon = icons[rule.severity];
            return (
              <li key={rule.id} className="flex items-start gap-2 text-sm">
                <Icon className={`mt-0.5 size-4 shrink-0 ${colors[rule.severity]}`} aria-hidden />
                <span className="text-muted-foreground">{rule.message}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {validation.pageCount != null ? (
        <p className="text-muted-foreground text-xs">
          {validation.pageCount} {de.letters.pageCount}
          {validation.sheetCountSimplex != null
            ? ` · ${validation.sheetCountSimplex} ${de.letters.sheetCount}`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
