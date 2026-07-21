"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { de } from "@/lib/i18n/de";
import { updateNotificationPrefsAction } from "./actions";

type PrefKey = "sendStatus" | "epostUpdates" | "topup" | "flowActivity";

const ROWS: { key: PrefKey; label: string; hint: string }[] = [
  { key: "topup", label: de.notifications.topupLabel, hint: de.notifications.topupHint },
  {
    key: "sendStatus",
    label: de.notifications.sendStatusLabel,
    hint: de.notifications.sendStatusHint,
  },
  {
    key: "epostUpdates",
    label: de.notifications.epostUpdatesLabel,
    hint: de.notifications.epostUpdatesHint,
  },
  {
    key: "flowActivity",
    label: de.notifications.flowActivityLabel,
    hint: de.notifications.flowActivityHint,
  },
];

export function NotificationsForm({ defaults }: { defaults: Record<PrefKey, boolean> }) {
  const [prefs, setPrefs] = useState(defaults);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const fd = new FormData();
    for (const { key } of ROWS) fd.set(key, prefs[key] ? "true" : "false");
    startTransition(async () => {
      const result = await updateNotificationPrefsAction(null, fd);
      if (result.ok) toast.success(de.notifications.saved);
      else toast.error(result.error);
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="divide-y pt-2">
          {ROWS.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center justify-between gap-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor={`pref-${key}`}>{label}</Label>
                <p className="text-muted-foreground text-sm">{hint}</p>
              </div>
              <Switch
                id={`pref-${key}`}
                checked={prefs[key]}
                onCheckedChange={(v) => setPrefs((p) => ({ ...p, [key]: v === true }))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="text-muted-foreground flex items-start gap-2 text-sm">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{de.notifications.alwaysOnNote}</p>
      </div>

      <Button onClick={save} disabled={pending}>
        {pending ? de.common.saving : de.common.save}
      </Button>
    </div>
  );
}
