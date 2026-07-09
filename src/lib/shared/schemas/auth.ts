import { z } from "zod";
import { de } from "@/lib/i18n/de";

export const emailSchema = z.string().trim().toLowerCase().email(de.auth.emailInvalid);

export const passwordSchema = z.string().min(8, de.auth.passwordTooShort).max(72);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, de.validation.fieldRequired),
});

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string(),
    displayName: z.string().trim().min(1, de.validation.fieldRequired).max(120),
    company: z.string().trim().max(160).optional().or(z.literal("")),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: de.auth.passwordMismatch,
    path: ["passwordConfirm"],
  });

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: de.auth.passwordMismatch,
    path: ["passwordConfirm"],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, de.validation.fieldRequired),
    password: passwordSchema,
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: de.auth.passwordMismatch,
    path: ["passwordConfirm"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
