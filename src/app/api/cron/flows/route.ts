import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/server/queue/cron-auth";
import { getJsonSetting } from "@/lib/server/settings";
import { runFlowScheduler } from "@/lib/server/flows/scheduler";

export const maxDuration = 60;

/**
 * Flow scheduler cron (every 5 min): fires due flow enrollments through the
 * existing send pipeline. Charge + item creation happen atomically at fire time
 * via confirm_send_job; delivery then runs through the normal submit_item queue.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Global kill switch (defaults on).
  if (!(await getJsonSetting<boolean>("flows_enabled", true))) {
    return NextResponse.json({ skipped: "disabled" });
  }
  try {
    return NextResponse.json(await runFlowScheduler());
  } catch (err) {
    console.error("flow_scheduler_failed", { error: err instanceof Error ? err.message : "?" });
    return NextResponse.json({ error: "scheduler_failed" }, { status: 500 });
  }
}
