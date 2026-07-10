import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  APP_NAME: z.string().default("Versendio"),
  APP_URL: z.string().url().optional(),
  MOCK_MODE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  FEATURE_STRIPE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  LETTER_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  EPOST_BASE_URL: z.string().url().default("https://api.epost.docuguide.com"),
  EPOST_VENDOR_ID: z.string().optional(),
  EPOST_EKP: z.string().optional(),
  EPOST_PASSWORD: z.string().optional(),
  EPOST_SECRET: z.string().optional(),
  EPOST_CREDENTIALS_KEY: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  SMTP_URL: z.string().optional(),

  ADMIN_EMAIL: z.string().email().optional(),
  CRON_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Validated server environment. Throws with a readable message on misconfiguration. */
export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = serverEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid server environment: ${details}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** True when the letter pipeline must use the MockProvider (ADR-0005 §2). */
export function isMockMode(): boolean {
  const env = serverEnv();
  return (
    env.MOCK_MODE ||
    !env.EPOST_VENDOR_ID ||
    !env.EPOST_EKP ||
    !env.EPOST_PASSWORD ||
    !env.EPOST_SECRET
  );
}
