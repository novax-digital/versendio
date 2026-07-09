"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server/env";
import { checkRateLimit, clientIp } from "@/lib/server/rate-limit";
import { type ActionResult, fieldErrorsFromZod } from "@/lib/server/action-result";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@/lib/shared/schemas/auth";
import { de } from "@/lib/i18n/de";

/**
 * Public base URL for auth redirect links. In production this MUST come from
 * APP_URL — deriving it from the Host/X-Forwarded-Host header would let an
 * attacker point password-reset/confirmation links at their own host
 * (account takeover). The header fallback is dev-only.
 */
async function baseUrl(): Promise<string> {
  const env = serverEnv();
  if (env.APP_URL) return env.APP_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL must be set in production to build safe auth links");
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function loginAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "", fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  // Two independent counters: per-IP caps spraying, per-account caps
  // distributed brute force against one login.
  const ip = await clientIp();
  const [ipOk, acctOk] = await Promise.all([
    checkRateLimit("login", `ip:${ip}`),
    checkRateLimit("login", `acct:${parsed.data.email}`),
  ]);
  if (!ipOk || !acctOk) {
    return { ok: false, error: de.common.rateLimited };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    if (error.code === "email_not_confirmed") {
      return { ok: false, error: de.auth.emailNotConfirmed };
    }
    return { ok: false, error: de.auth.invalidCredentials };
  }

  redirect("/app");
}

export async function registerAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "", fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  const ip = await clientIp();
  if (!(await checkRateLimit("register", ip))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${await baseUrl()}/auth/callback?next=/app`,
      data: {
        display_name: parsed.data.displayName,
        company: parsed.data.company || null,
      },
    },
  });

  if (error) {
    console.error("register_failed", { code: error.code });
    return { ok: false, error: de.common.genericError };
  }

  // Identical response whether or not the address already exists — prevents
  // account enumeration; existing users receive a "you already have an
  // account" mail from Supabase instead of a confirmation link.
  return { ok: true };
}

export async function forgotPasswordAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "", fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  const ip = await clientIp();
  if (!(await checkRateLimit("forgot_password", ip))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await baseUrl()}/auth/callback?next=/passwort-zuruecksetzen`,
  });
  if (error) {
    // Deliberately not surfaced: the success message is identical either way.
    console.error("forgot_password_failed", { code: error.code });
  }

  return { ok: true };
}

export async function resetPasswordAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "", fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: de.auth.resetLinkInvalid };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("reset_password_failed", { code: error.code });
    return { ok: false, error: de.common.genericError };
  }

  return { ok: true };
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
