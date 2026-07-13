import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { getStripe, stripeEnabled } from "@/lib/server/stripe";

/**
 * Invoice download for a credit transaction: resolves the Stripe invoice
 * FRESH (the stored receipt_url is a best-effort snapshot from booking time)
 * and redirects to the PDF. Falls back to the stored receipt link. Ownership
 * is double-guarded: RLS plus the explicit user_id filter.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: tx } = await supabase
    .from("credit_transactions")
    .select("id, stripe_invoice_id, receipt_url")
    .eq("id", id)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (!tx) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (tx.stripe_invoice_id && stripeEnabled()) {
    try {
      const invoice = await getStripe().invoices.retrieve(tx.stripe_invoice_id);
      const url = invoice.invoice_pdf ?? invoice.hosted_invoice_url;
      if (url) return NextResponse.redirect(url, 302);
    } catch (err) {
      console.error("invoice_download_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
      // fall through to the stored receipt link
    }
  }
  if (tx.receipt_url) return NextResponse.redirect(tx.receipt_url, 302);
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
