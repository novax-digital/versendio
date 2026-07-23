"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { de } from "@/lib/i18n/de";
import { updateCoverFooterAction } from "./actions";

/**
 * Toggle for the "sent via versendio.de" notice on auto-generated cover
 * pages. Saves immediately on switch (single boolean — a separate save
 * button would be ceremony), reverting the optimistic state on failure.
 */
export function CoverFooterForm({ defaultEnabled }: { defaultEnabled: boolean }) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [pending, startTransition] = useTransition();

  const onToggle = (value: boolean) => {
    setEnabled(value);
    const fd = new FormData();
    fd.set("coverFooter", value ? "true" : "false");
    startTransition(async () => {
      const result = await updateCoverFooterAction(null, fd);
      if (result.ok) {
        toast.success(de.profile.saved);
      } else {
        setEnabled(!value);
        toast.error(result.error);
      }
    });
  };

  return (
    <section className="space-y-2 pt-4">
      <h2 className="text-sm font-medium">{de.profile.coverFooterTitle}</h2>
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="cover-footer">{de.profile.coverFooterLabel}</Label>
            <p className="text-muted-foreground text-sm">{de.profile.coverFooterHint}</p>
          </div>
          <Switch
            id="cover-footer"
            checked={enabled}
            disabled={pending}
            onCheckedChange={(v) => onToggle(v === true)}
          />
        </CardContent>
      </Card>
    </section>
  );
}
