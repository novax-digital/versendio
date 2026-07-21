/**
 * Pure helpers for Flow delays. A flow stores its delay as integer minutes; the
 * UI enters a value + unit (hours/days). These functions are the single source
 * of truth for that conversion and for computing an enrollment's send time.
 */
export const DELAY_UNITS = ["hours", "days"] as const;
export type DelayUnit = (typeof DELAY_UNITS)[number];

/** Upper bound on a flow delay (1 year), enough headroom without absurd values. */
export const MAX_DELAY_MINUTES = 365 * 24 * 60;

const MINUTES_PER = { hours: 60, days: 24 * 60 } as const;

/** Convert a value + unit to whole minutes. Throws on negative/non-finite input. */
export function parseDelay(value: number, unit: DelayUnit): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("delay value must be a non-negative finite number");
  }
  return Math.round(value * MINUTES_PER[unit]);
}

/** Present minutes as the coarsest whole unit (whole days if divisible, else hours). */
export function minutesToDelay(minutes: number): { value: number; unit: DelayUnit } {
  if (minutes > 0 && minutes % MINUTES_PER.days === 0) {
    return { value: minutes / MINUTES_PER.days, unit: "days" };
  }
  return { value: Math.round(minutes / MINUTES_PER.hours), unit: "hours" };
}

/** German label for a delay in minutes, e.g. "5 Tage", "1 Stunde". */
export function formatDelay(minutes: number): string {
  const { value, unit } = minutesToDelay(minutes);
  if (unit === "days") return `${value} ${value === 1 ? "Tag" : "Tage"}`;
  return `${value} ${value === 1 ? "Stunde" : "Stunden"}`;
}

/** Absolute send time = enrollment time + delay. Throws on a negative delay. */
export function computeScheduledSendAt(enrolledAt: Date, delayMinutes: number): Date {
  if (!Number.isInteger(delayMinutes) || delayMinutes < 0) {
    throw new RangeError("delayMinutes must be a non-negative integer");
  }
  return new Date(enrolledAt.getTime() + delayMinutes * 60_000);
}

/** An active flow, with the target list it enrolls contacts through. */
export type ActiveFlowOption = { id: string; name: string; listId: string };

/** One selectable enrollment target: a list plus the active flows bound to it. */
export type ActiveFlowGroup = { listId: string; flows: ActiveFlowOption[] };

/**
 * Groups active flows by their target list. Enrollment is list-based — the DB
 * trigger enrolls a contact into EVERY active flow bound to a list it enters —
 * so the picker must offer one entry per list, not per flow: selecting a list
 * enrolls into all of its flows, and there is no way to pick a strict subset.
 * Insertion order of first occurrence is preserved (input is newest-first).
 */
export function groupActiveFlowsByList(flows: ActiveFlowOption[]): ActiveFlowGroup[] {
  const byList = new Map<string, ActiveFlowOption[]>();
  for (const flow of flows) {
    const bucket = byList.get(flow.listId);
    if (bucket) bucket.push(flow);
    else byList.set(flow.listId, [flow]);
  }
  return [...byList].map(([listId, listFlows]) => ({ listId, flows: listFlows }));
}
