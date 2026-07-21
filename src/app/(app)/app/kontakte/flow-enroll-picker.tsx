"use client";

import { Workflow } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { type ActiveFlowOption, groupActiveFlowsByList } from "@/lib/shared/flows";
import { de } from "@/lib/i18n/de";

/**
 * Opt-in selection of active flows, shown when creating or importing contacts.
 * Options are grouped by target list: enrollment is list-based (adding a contact
 * to a list enrolls it into every active flow bound to it), so a shared list is
 * one selectable entry labelled with all its flows — there is no way to pick a
 * strict subset. Selection state (flow ids) is owned by the parent so it can be
 * submitted. Renders nothing when the user has no active flow.
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

  const groups = groupActiveFlowsByList(flows);

  const toggle = (groupFlowIds: string[], on: boolean) => {
    const set = new Set(selected);
    for (const id of groupFlowIds) {
      if (on) set.add(id);
      else set.delete(id);
    }
    onChange([...set]);
  };

  return (
    <div className="border-primary/30 bg-primary/5 space-y-3 rounded-lg border border-dashed p-3">
      <div className="flex items-center gap-2">
        <Workflow className="text-primary size-4" aria-hidden />
        <p className="text-sm font-medium">{de.contacts.flowEnrollTitle}</p>
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
      <div className="space-y-2">
        {groups.map((group) => {
          const flowIds = group.flows.map((f) => f.id);
          const checked = flowIds.every((id) => selected.includes(id));
          const domId = `flow-list-${group.listId}`;
          return (
            <div key={group.listId} className="flex items-center gap-2">
              <Checkbox
                id={domId}
                checked={checked}
                onCheckedChange={(v) => toggle(flowIds, v === true)}
              />
              <Label htmlFor={domId} className="font-normal">
                {group.flows.map((f) => f.name).join(", ")}
              </Label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
