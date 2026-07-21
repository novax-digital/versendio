"use client";

import { useActionState } from "react";
import { registerAction } from "../actions";
import { SocialLogin } from "../social-login";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { de } from "@/lib/i18n/de";

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  if (state?.ok) {
    return (
      <p
        role="status"
        className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      >
        {de.auth.registerSuccess}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <SocialLogin />
      <form action={formAction} className="space-y-4" noValidate>
        <FormField
          label={de.auth.displayName}
          name="displayName"
          autoComplete="name"
          required
          error={fieldErrors?.displayName}
        />
        <FormField
          label={de.auth.company}
          name="company"
          autoComplete="organization"
          optionalLabel={de.common.optional}
          error={fieldErrors?.company}
        />
        <FormField
          label={de.auth.email}
          name="email"
          type="email"
          autoComplete="email"
          required
          error={fieldErrors?.email}
        />
        <FormField
          label={de.auth.password}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint={de.auth.passwordHint}
          error={fieldErrors?.password}
        />
        <FormField
          label={de.auth.passwordConfirm}
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          required
          error={fieldErrors?.passwordConfirm}
        />
        {state && !state.ok && state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? de.common.loading : de.auth.registerButton}
        </Button>
        {/* Legal pages live on the marketing site (same pattern as the app
            footer); new tab so the half-filled form stays put. */}
        <p className="text-muted-foreground text-xs">
          {de.auth.consentPrefix}{" "}
          <a
            href="https://versendio.de/agb"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-4"
          >
            {de.legal.terms}
          </a>{" "}
          {de.auth.consentAnd}{" "}
          <a
            href="https://versendio.de/datenschutz"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-4"
          >
            {de.legal.privacy}
          </a>
          .
        </p>
      </form>
    </div>
  );
}
