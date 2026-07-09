import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/server/queue/cron-auth";
import { syncStatuses } from "@/lib/server/send/status-sync";

export const maxDuration = 60;

/** Throttled provider status polling — every 15 minutes (ADR-0004 §3). */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncStatuses();
    return NextResponse.json(result);
  } catch (err) {
    console.error("status_sync_failed", { error: err instanceof Error ? err.message : "?" });
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }
}
