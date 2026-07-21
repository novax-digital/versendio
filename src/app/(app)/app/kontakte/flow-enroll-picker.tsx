"use client";

import { Workflow } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ActiveFlowOption } from "@/lib/server/flows/active-flows";
import { de } from "@/lib/i18n/de";

/**
 * Opt-in multi-select of active flows, shown when creating or importing
 * contacts. Selection state is owned by the parent so it can be submitted
 * (hidden inputs in the contact form, action payload in the import wizard).
 * Renders nothing when the user has no active flow.
 */
export function FlowEnrollPicker({
  flows,
  selected,
  onChange,
  hint,
}: {
  flows: ActiveFlowOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  hint: string;
}) {
  if (flows.length === 0) return null;

  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...selected, id] : selected.filter((x) => x !== id));

  return (
    <div className="border-primary/30 bg-primary/5 space-y-3 rounded-lg border border-dashed p-3">
      <div className="flex items-center gap-2">
        <Workflow className="text-primary size-4" aria-hidden />
        <p className="text-sm font-medium">{de.contacts.flowEnrollTitle}</p>
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
      <div className="space-y-2">
        {flows.map((flow) => {
          const domId = `flow-${flow.id}`;
          return (
            <div key={flow.id} className="flex items-center gap-2">
              <Checkbox
                id={domId}
                checked={selected.includes(flow.id)}
                onCheckedChange={(v) => toggle(flow.id, v === true)}
              />
              <Label htmlFor={domId} className="font-normal">
                {flow.name}
              </Label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
