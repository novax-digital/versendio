"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateSettingAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { de } from "@/lib/i18n/de";

export type Setting = { key: string; value: unknown };

const HINTS: Record<string, string> = {
  topup_bonus_tiers:
    'Beispiel: [{"threshold_cents":5000,"bonus_percent":10},{"threshold_cents":10000,"bonus_cents":1500}] — je Stufe entweder bonus_percent ODER bonus_cents. Leeres Array [] = kein Bonus.',
};

const LABELS: Record<string, string> = {
  topup_amounts_cents: "Aufladebeträge (Cent)",
  topup_min_cents: "Mindestbetrag (Cent)",
  topup_max_cents: "Höchstbetrag (Cent)",
  topup_bonus_tiers: "Bonus-Guthaben je Aufladehöhe",
  low_credit_threshold_cents: "Schwellwert „Guthaben niedrig“ (Cent)",
  queue_batch_size: "Queue-Batchgröße je Lauf",
  status_sync_interval_minutes: "Status-Sync-Intervall (Minuten)",
  status_sync_max_queries_per_run: "Max. Einzelabfragen je Sync-Lauf",
  mock_fail_percent: "Mock: Fehlerquote (%)",
  mock_status_step_minutes: "Mock: Statuswechsel alle X Minuten",
  ai_drafts_enabled: "KI-Entwürfe aktiviert",
  ai_daily_draft_limit: "KI-Entwürfe: Tageslimit je Nutzer (0 = aus)",
};

export function SettingsList({ settings }: { settings: Setting[] }) {
  return (
    <ul className="space-y-4">
      {settings.map((setting) => (
        <li key={setting.key}>
          <SettingRow setting={setting} />
        </li>
      ))}
    </ul>
  );
}

function SettingRow({ setting }: { setting: Setting }) {
  const router = useRouter();
  const initial = JSON.stringify(setting.value);
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const fd = new FormData();
    fd.set("key", setting.key);
    fd.set("value", value);
    startTransition(async () => {
      const result = await updateSettingAction(null, fd);
      if (result.ok) {
        toast.success(de.admin.settingSaved);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1 space-y-1.5">
        <Label htmlFor={`setting-${setting.key}`}>
          {LABELS[setting.key] ?? setting.key}
          <span className="text-muted-foreground ml-2 font-mono text-xs">{setting.key}</span>
        </Label>
        <Input
          id={`setting-${setting.key}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="font-mono text-sm"
        />
        {HINTS[setting.key] ? (
          <p className="text-muted-foreground text-xs">{HINTS[setting.key]}</p>
        ) : null}
      </div>
      <Button size="sm" onClick={save} disabled={pending || value === initial}>
        {de.common.save}
      </Button>
    </div>
  );
}
