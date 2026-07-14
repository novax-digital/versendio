"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { createSetupSessionAction, syncPaymentMethodAction } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { de } from "@/lib/i18n/de";

// Module-scope so Stripe.js loads once. Empty string when the key is missing —
// the button then surfaces a clear error instead of mounting a broken widget.
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise: Promise<Stripe | null> | null = publishableKey
  ? loadStripe(publishableKey)
  : null;

export function AddPaymentMethodDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const start = async () => {
    if (!stripePromise) {
      toast.error(de.credits.stripeDisabled);
      return;
    }
    setPending(true);
    try {
      const result = await createSetupSessionAction();
      if (!result.ok || !result.data) {
        toast.error(result.ok ? de.common.genericError : result.error);
        return;
      }
      setClientSecret(result.data.clientSecret);
      setSessionId(result.data.sessionId);
      setOpen(true);
    } catch {
      // A thrown action would otherwise leave the button doing nothing.
      toast.error(de.common.genericError);
    } finally {
      setPending(false);
    }
  };

  const onComplete = useCallback(async () => {
    if (sessionId) {
      const result = await syncPaymentMethodAction({ sessionId });
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(de.credits.paymentMethodSaved);
      }
    }
    setOpen(false);
    setClientSecret(null);
    setSessionId(null);
    router.refresh();
  }, [sessionId, router]);

  return (
    <>
      <Button variant="outline" onClick={start} disabled={pending}>
        <CreditCard className="size-4" aria-hidden />
        {de.credits.savePaymentMethod}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setClientSecret(null);
            setSessionId(null);
          }
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{de.credits.savePaymentMethod}</DialogTitle>
          </DialogHeader>
          {clientSecret && stripePromise ? (
            <EmbeddedCheckoutProvider
              stripe={stripePromise}
              options={{ clientSecret, onComplete }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
