"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ticket } from "lucide-react";
import { redeemVoucherAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";

export function RedeemVoucherCard() {
  const [state, formAction, pending] = useActionState(redeemVoucherAction, null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(de.credits.voucherRedeemed(formatCents(state.data?.amountCents ?? 0)));
      formRef.current?.reset();
      router.refresh();
    } else if (state && !state.ok && state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Ticket className="size-4" aria-hidden />
          {de.credits.voucherTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-3 text-sm">{de.credits.voucherSubtitle}</p>
        <form ref={formRef} action={formAction} className="flex flex-col gap-2 sm:flex-row">
          <Input
            name="code"
            required
            maxLength={40}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder={de.credits.voucherPlaceholder}
            className="font-mono uppercase sm:max-w-xs"
            aria-label={de.credits.voucherTitle}
          />
          <Button type="submit" disabled={pending}>
            {pending ? de.credits.voucherRedeeming : de.credits.voucherRedeem}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
