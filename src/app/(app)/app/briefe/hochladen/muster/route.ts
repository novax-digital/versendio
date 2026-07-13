import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/server/auth-context";
import { buildMusterPdf } from "@/lib/server/pdf/muster";

/** Downloadable sample PDF showing the Schablone-V3 zones for uploads. */
export async function GET() {
  await requireProfile();
  const bytes = await buildMusterPdf();
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="versendio-muster-brief.pdf"',
      "Cache-Control": "private, max-age=3600",
    },
  });
}
