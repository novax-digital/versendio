"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Ban, KeyRound, ShieldCheck, Wallet } from "lucide-react";
import {
  adjustCreditsAction,
  setUserStatusAction,
  setUserPlanAction,
  sendPasswordResetAction,
} from "../../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { de } from "@/lib/i18n/de";

type Plan = { id: string; name: string; discount_percent: number };

export function UserActions({
  userId,
  status,
  planId,
  plans,
  isSelf,
}: {
  userId: string;
  status: string;
  planId: string | null;
  plans: Plan[];
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, successMsg: string) => {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(successMsg);
        router.refresh();
      } else {
        toast.error(result.error ?? de.common.genericError);
      }
    });
  };

  const adjust = () => {
    const cents = Math.round(Number(amount.replace(",", ".")));
    if (!Number.isFinite(cents) || cents === 0) {
      toast.error(de.common.genericError);
      return;
    }
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("amountCents", String(cents));
    fd.set("comment", comment);
    run(
      async () => {
        const result = await adjustCreditsAction(null, fd);
        if (result.ok) {
          setAmount("");
          setComment("");
        }
        return result;
      },
      de.admin.creditsAdjusted,
    );
  };

  const toggleStatus = () => {
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("status", status === "blocked" ? "active" : "blocked");
    run(() => setUserStatusAction(null, fd), de.admin.statusChanged);
  };

  const changePlan = (newPlanId: string | null) => {
    if (!newPlanId || newPlanId === planId) return;
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("planId", newPlanId);
    run(() => setUserPlanAction(null, fd), de.admin.planChanged);
  };

  const resetPassword = () => {
    const fd = new FormData();
    fd.set("userId", userId);
    run(() => sendPasswordResetAction(null, fd), de.admin.passwordResetSent);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-4" aria-hidden />
            {de.admin.adjustCredits}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="adjust-amount">{de.admin.adjustAmount}</Label>
            <Input
              id="adjust-amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="2500"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-comment">{de.admin.adjustComment}</Label>
            <Input
              id="adjust-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Manuelle Aufladung nach Überweisung"
            />
          </div>
          <Button onClick={adjust} disabled={pending || !amount || comment.trim().length < 3}>
            {de.admin.adjustCredits}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" aria-hidden />
            {de.admin.userDetail}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{de.admin.plan}</Label>
            <Select value={planId ?? undefined} onValueChange={changePlan} disabled={pending}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={de.admin.plan} />
              </SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {plan.name}
                    {plan.discount_percent > 0 ? ` (−${plan.discount_percent} %)` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={toggleStatus}
              disabled={pending || isSelf || status === "deleted"}
              className={status === "blocked" ? "" : "text-destructive"}
            >
              <Ban className="size-4" aria-hidden />
              {status === "blocked" ? de.admin.unblockUser : de.admin.blockUser}
            </Button>
            <Button variant="outline" onClick={resetPassword} disabled={pending}>
              <KeyRound className="size-4" aria-hidden />
              {de.admin.passwordReset}
            </Button>
          </div>
          {isSelf ? (
            <p className="text-muted-foreground text-xs">{de.admin.cannotBlockSelf}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
