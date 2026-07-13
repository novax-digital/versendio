"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { startTopupAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents, grossFromNetCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";

export function TopupSection({
  amountsCents,
  minCents,
}: {
  amountsCents: number[];
  minCents: number;
}) {
  const [selected, setSelected] = useState<number>(amountsCents[0] ?? 1000);
  const [custom, setCustom] = useState("");
  const [pending, startTransition] = useTransition();

  const customCents = custom ? Math.round(Number(custom.replace(",", ".")) * 100) : null;
  const effectiveCents = customCents && customCents > 0 ? customCents : selected;

  const submit = () => {
    const fd = new FormData();
    fd.set("amountCents", String(effectiveCents));
    startTransition(async () => {
      const result = await startTopupAction(null, fd);
      // On success the action redirects to Stripe; only errors return.
      if (result && !result.ok) toast.error(result.error);
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">{de.credits.topupHint}</p>
      <div className="flex flex-wrap gap-2">
        {amountsCents.map((amount) => (
          <Button
            key={amount}
            type="button"
            variant={selected === amount && !custom ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setSelected(amount);
              setCustom("");
            }}
          >
            {formatCents(amount)}
          </Button>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="custom-amount">{de.credits.customAmount}</Label>
        <Input
          id="custom-amount"
          inputMode="decimal"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={(minCents / 100).toFixed(2).replace(".", ",")}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {effectiveCents > 0
          ? de.credits.vatNotice(formatCents(grossFromNetCents(effectiveCents)))
          : de.credits.vatNoticeGeneric}
      </p>
      <Button onClick={submit} disabled={pending} className="w-full">
        {pending ? de.common.loading : de.credits.topupButton}
      </Button>
    </div>
  );
}
