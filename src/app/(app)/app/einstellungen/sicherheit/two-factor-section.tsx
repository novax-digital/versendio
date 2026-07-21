"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { de } from "@/lib/i18n/de";

type Enrollment = { factorId: string; qrCode: string; secret: string };

/**
 * Optional TOTP two-factor management via Supabase MFA. Uses the browser
 * (user-session) client — never the service role. Requires MFA enabled in the
 * Supabase project (Auth → Multi-Factor).
 */
export function TwoFactorSection() {
  // Stable browser client across renders (createClient makes a fresh one).
  const [supabase] = useState(createClient);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.find((f) => f.status === "verified");
    setVerifiedFactorId(verified?.id ?? null);
    setLoaded(true);
  }, [supabase]);

  useEffect(() => {
    // Load enrolled factors once on mount (async → setState after await).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const startEnroll = () => {
    startTransition(async () => {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `TOTP ${Date.now()}`,
        // Shown as the entry name in authenticator apps. Without it Supabase
        // falls back to the project's Site URL (localhost in dev setups).
        issuer: "Versendio",
      });
      if (error || !data) {
        toast.error(de.profile.twoFactorEnrollFailed);
        return;
      }
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setCode("");
    });
  };

  const cancelEnroll = () => {
    if (!enrollment) return;
    const factorId = enrollment.factorId;
    setEnrollment(null);
    setCode("");
    // Drop the unverified factor so it does not linger.
    void supabase.auth.mfa.unenroll({ factorId });
  };

  const verify = () => {
    if (!enrollment) return;
    startTransition(async () => {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrollment.factorId,
        code: code.trim(),
      });
      if (error) {
        toast.error(de.profile.twoFactorInvalidCode);
        return;
      }
      toast.success(de.profile.twoFactorEnabled);
      setEnrollment(null);
      setCode("");
      await refresh();
    });
  };

  const disable = () => {
    if (!verifiedFactorId) return;
    startTransition(async () => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactorId });
      if (error) {
        toast.error(de.common.genericError);
        return;
      }
      toast.success(de.profile.twoFactorDisabled);
      await refresh();
    });
  };

  return (
    <section className="space-y-3 border-t pt-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="text-muted-foreground size-4" aria-hidden />
        <h2 className="text-lg font-medium">{de.profile.twoFactorTitle}</h2>
        {loaded ? (
          <Badge
            variant="outline"
            className={verifiedFactorId ? "border-success text-success" : ""}
          >
            {verifiedFactorId ? de.profile.twoFactorActive : de.profile.twoFactorInactive}
          </Badge>
        ) : null}
      </div>
      <p className="text-muted-foreground text-sm">{de.profile.twoFactorHint}</p>

      {!loaded ? null : verifiedFactorId ? (
        <Button variant="outline" className="text-destructive" onClick={disable} disabled={pending}>
          {de.profile.twoFactorDisable}
        </Button>
      ) : enrollment ? (
        <div className="max-w-sm space-y-3 rounded-md border p-4">
          <p className="text-muted-foreground text-sm">{de.profile.twoFactorScanHint}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data-URI SVG from Supabase */}
          <img
            src={enrollment.qrCode}
            alt=""
            className="bg-white"
            width={180}
            height={180}
          />
          <div className="space-y-1">
            <Label className="text-xs">{de.profile.twoFactorSecretLabel}</Label>
            <code className="bg-muted block overflow-x-auto rounded px-2 py-1 font-mono text-xs">
              {enrollment.secret}
            </code>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="totp-code">{de.profile.twoFactorCodeLabel}</Label>
            <Input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={verify} disabled={pending || code.length !== 6}>
              {de.profile.twoFactorVerify}
            </Button>
            <Button variant="ghost" onClick={cancelEnroll} disabled={pending}>
              {de.profile.twoFactorCancel}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={startEnroll} disabled={pending}>
          {de.profile.twoFactorEnable}
        </Button>
      )}
    </section>
  );
}
