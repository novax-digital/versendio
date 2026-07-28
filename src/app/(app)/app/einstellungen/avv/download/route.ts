import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/server/auth-context";
import { downloadObject, BUCKETS } from "@/lib/server/storage";
import { avvStoragePath } from "@/lib/server/avv";
import { de } from "@/lib/i18n/de";

/** Streams the user's stored signed AVV (generated earlier) as a download. */
export async function GET() {
  const profile = await requireProfile();

  const bytes = await downloadObject(BUCKETS.assets, avvStoragePath(profile.id));
  if (!bytes) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${de.avv.downloadName}"`,
      "Cache-Control": "no-store",
    },
  });
}
