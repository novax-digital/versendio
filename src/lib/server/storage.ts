import "server-only";
import { createClient } from "@/lib/supabase/server";

export const BUCKETS = {
  letters: "letters",
  assets: "assets",
  imports: "imports",
} as const;

/** Uploads bytes to a private bucket under the user's own prefix (RLS-scoped). */
export async function uploadObject(
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(bucket).upload(path, bytes as unknown as Blob, {
    contentType,
    upsert: true,
  });
  if (error) {
    console.error("storage_upload_failed", { bucket, error: error.message });
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Downloads an object's bytes (RLS-scoped to the caller). */
export async function downloadObject(bucket: string, path: string): Promise<Uint8Array | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    console.error("storage_download_failed", { bucket, error: error?.message });
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
}

/** Creates a short-lived signed URL for previewing a private object. */
export async function signedUrl(
  bucket: string,
  path: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) {
    console.error("storage_sign_failed", { bucket, error: error?.message });
    return null;
  }
  return data.signedUrl;
}

export async function removeObject(bucket: string, path: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) console.error("storage_remove_failed", { bucket, error: error.message });
}
