import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeEnabled } from "@/lib/server/stripe";

/** Admin variant of the invoice download: any transaction, fresh Stripe PDF. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const { data: tx } = await admin
    .from("credit_transactions")
    .select("id, stripe_invoice_id, receipt_url")
    .eq("id", id)
    .maybeSingle();
  if (!tx) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (tx.stripe_invoice_id && stripeEnabled()) {
    try {
      const invoice = await getStripe().invoices.retrieve(tx.stripe_invoice_id);
      const url = invoice.invoice_pdf ?? invoice.hosted_invoice_url;
      if (url) return NextResponse.redirect(url, 302);
    } catch (err) {
      console.error("admin_invoice_download_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  if (tx.receipt_url) return NextResponse.redirect(tx.receipt_url, 302);
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
