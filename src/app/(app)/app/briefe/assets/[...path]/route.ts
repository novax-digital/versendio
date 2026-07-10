import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/server/auth-context";
import { downloadObject, BUCKETS } from "@/lib/server/storage";

/**
 * Serves a user's own letter assets (logos, image blocks) from the private
 * assets bucket for the builder canvas. Ownership boundary: asset paths are
 * keyed `<userId>/...` at upload time — anything outside the caller's prefix
 * is a 404. Same-origin, so no CSP img-src changes are needed.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const profile = await requireProfile();
  const { path } = await ctx.params;
  // Next delivers catch-all segments already percent-decoded; decoding again
  // both double-decodes and can throw on malformed input.
  const storagePath = path.join("/");

  if (
    storagePath.includes("..") ||
    !storagePath.startsWith(`${profile.id}/`)
  ) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const bytes = await downloadObject(BUCKETS.assets, storagePath);
  if (!bytes) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const contentType = storagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
    },
  });
}
