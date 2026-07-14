"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { removePaymentMethodAction, updateAutoTopupAction } from "./actions";
import { AddPaymentMethodDialog } from "./add-payment-method-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { de } from "@/lib/i18n/de";

export function AutoTopupSection({
  enabled,
  thresholdCents,
  amountCents,
  hasPaymentMethod,
}: {
  enabled: boolean;
  thresholdCents: number;
  amountCents: number;
  hasPaymentMethod: boolean;
}) {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [threshold, setThreshold] = useState((thresholdCents / 100).toFixed(2));
  const [amount, setAmount] = useState((amountCents / 100).toFixed(2));
  const [pending, startTransition] = useTransition();

  const save = () => {
    const fd = new FormData();
    fd.set("enabled", isEnabled ? "true" : "false");
    fd.set("thresholdCents", String(Math.round(Number(threshold.replace(",", ".")) * 100) || 0));
    fd.set("amountCents", String(Math.round(Number(amount.replace(",", ".")) * 100) || 0));
    startTransition(async () => {
      const result = await updateAutoTopupAction(null, fd);
      if (result.ok) toast.success(de.credits.autoTopupSaved);
      else toast.error(result.error);
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await removePaymentMethodAction();
      if (result.ok) {
        toast.success(de.credits.paymentMethodRemoved);
        setIsEnabled(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {de.credits.autoTopupTitle}
          {hasPaymentMethod ? (
            <Badge variant="outline" className="border-emerald-500 text-emerald-600">
              {de.credits.paymentMethodSaved}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">{de.credits.autoTopupHint}</p>

        {!hasPaymentMethod ? (
          <AddPaymentMethodDialog />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Switch id="auto-enabled" checked={isEnabled} onCheckedChange={setIsEnabled} />
              <Label htmlFor="auto-enabled" className="font-normal">
                {de.credits.autoTopupEnable}
              </Label>
            </div>
            {isEnabled ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="auto-threshold">{de.credits.threshold}</Label>
                  <Input
                    id="auto-threshold"
                    inputMode="decimal"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="auto-amount">{de.credits.autoAmount}</Label>
                  <Input
                    id="auto-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} disabled={pending}>
                {pending ? de.common.saving : de.common.save}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={remove}
                disabled={pending}
              >
                <Trash2 className="size-3.5" aria-hidden />
                {de.credits.removePaymentMethod}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
