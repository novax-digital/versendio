import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Reads a numeric app setting with a fallback (service-role only table). */
export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  const value = Number(data?.value);
  return Number.isFinite(value) ? value : fallback;
}

/** Reads a JSON app setting with a fallback. */
export async function getJsonSetting<T>(key: string, fallback: T): Promise<T> {
  const admin = createAdminClient();
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
