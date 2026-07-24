import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/server/queue/cron-auth";
import { getJsonSetting } from "@/lib/server/settings";
import { runMocoSync } from "@/lib/server/moco/sync";
import { runMocoFlowSync } from "@/lib/server/moco/flow-sync";

export const maxDuration = 60;

/**
 * MOCO sync cron (every 10 min), two phases sharing the time budget:
 * 1. Document auto-send: polls connected accounts for new invoices/payment
 *    reminders per the user's rules and dispatches them as letters (charge
 *    via confirm_send_job, delivery via the submit_item queue).
 * 2. Flow feeder: scans MOCO events for flows with source='moco' and pushes
 *    recipients into the flows' lead lists (existing enrollment machinery).
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Global kill switch (defaults on).
  if (!(await getJsonSetting<boolean>("moco_enabled", true))) {
    return NextResponse.json({ skipped: "disabled" });
  }
  try {
    const deadline = Date.now() + 50_000;
    const documents = await runMocoSync();
    const flows = Date.now() < deadline ? await runMocoFlowSync(deadline) : { flows: 0, enrolled: 0 };
    return NextResponse.json({ ...documents, flowSync: flows });
  } catch (err) {
    console.error("moco_sync_failed", { error: err instanceof Error ? err.message : "?" });
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }
}
