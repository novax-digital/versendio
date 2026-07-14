"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { ProfileForm } from "@/app/(app)/app/einstellungen/profile-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { de } from "@/lib/i18n/de";

export type BillingDefaults = {
  displayName: string;
  company: string;
  billingStreet: string;
  billingZip: string;
  billingCity: string;
  billingCountry: string;
};

/**
 * Billing-address summary on the credits page — mirrors the settings profile
 * form so users can complete/change it without leaving the top-up flow (a
 * complete address is required for the Stripe VAT invoice before top-up).
 */
export function BillingAddressCard({ defaults }: { defaults: BillingDefaults }) {
  const [open, setOpen] = useState(false);
  const complete =
    !!defaults.billingStreet.trim() &&
    !!defaults.billingZip.trim() &&
    !!defaults.billingCity.trim();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{de.profile.billingAddress}</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Pencil className="size-3.5" aria-hidden />
          {de.common.edit}
        </Button>
      </CardHeader>
      <CardContent>
        {complete ? (
          <address className="text-sm not-italic">
            {defaults.company ? <div>{defaults.company}</div> : null}
            <div>{defaults.billingStreet}</div>
            <div>
              {defaults.billingZip} {defaults.billingCity}
              {defaults.billingCountry && defaults.billingCountry !== "DE"
                ? ` (${defaults.billingCountry})`
                : ""}
            </div>
          </address>
        ) : (
          <p className="text-warning text-sm">{de.credits.billingAddressRequired}</p>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{de.profile.billingAddress}</DialogTitle>
          </DialogHeader>
          <ProfileForm defaults={defaults} onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
