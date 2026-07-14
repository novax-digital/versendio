"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { de } from "@/lib/i18n/de";

/** Login step-up: verify a TOTP code to raise the session to AAL2. */
export function MfaForm() {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();

  const verify = () => {
    startTransition(async () => {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp?.find((f) => f.status === "verified");
      if (!factor) {
        // Nothing to step up against — proceed.
        router.replace("/app");
        return;
      }
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: code.trim(),
      });
      if (error) {
        toast.error(de.profile.twoFactorInvalidCode);
        return;
      }
      // Full navigation so server components re-read the elevated session.
      window.location.assign("/app");
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        verify();
      }}
    >
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{de.profile.twoFactorLoginTitle}</h1>
        <p className="text-muted-foreground text-sm">{de.profile.twoFactorLoginSubtitle}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mfa-code">{de.profile.twoFactorCodeLabel}</Label>
        <Input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
      </div>
      <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
        {de.profile.twoFactorLoginVerify}
      </Button>
    </form>
  );
}
