"use client";

import { useActionState } from "react";
import { forgotPasswordAction } from "../actions";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { de } from "@/lib/i18n/de";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  if (state?.ok) {
    return (
      <p
        role="status"
        className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      >
        {de.auth.forgotSuccess}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormField
        label={de.auth.email}
        name="email"
        type="email"
        autoComplete="email"
        required
        error={fieldErrors?.email}
      />
      {state && !state.ok && state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? de.common.loading : de.auth.forgotButton}
      </Button>
    </form>
  );
}
