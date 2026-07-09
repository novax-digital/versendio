import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/server/auth-context";
import { exportUserData } from "@/lib/server/gdpr/export-data";
import { checkRateLimit } from "@/lib/server/rate-limit";

/** GDPR data export download (JSON). Rate-limited: the export is expensive. */
export async function GET() {
  const profile = await requireProfile();
  if (!(await checkRateLimit("upload", `export:${profile.id}`))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const data = await exportUserData(profile.id);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="datenexport-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
