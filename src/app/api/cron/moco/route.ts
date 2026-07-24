import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/server/queue/cron-auth";
import { getJsonSetting } from "@/lib/server/settings";
import { runMocoSync } from "@/lib/server/moco/sync";

export const maxDuration = 60;

/**
 * MOCO sync cron (every 10 min): polls connected MOCO accounts for new
 * invoices/payment reminders per the user's auto-send rules and dispatches
 * them as letters through the regular send pipeline (charge via
 * confirm_send_job, delivery via the submit_item queue).
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
    return NextResponse.json(await runMocoSync());
  } catch (err) {
    console.error("moco_sync_failed", { error: err instanceof Error ? err.message : "?" });
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }
}
