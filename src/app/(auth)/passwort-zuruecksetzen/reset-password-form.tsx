"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { resetPasswordAction } from "../actions";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { de } from "@/lib/i18n/de";

export function ResetPasswordForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(resetPasswordAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) {
      router.replace("/login?reset=success");
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormField
        label={de.auth.newPassword}
        name="password"
        type="password"
        autoComplete="new-password"
        required
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
        {pending ? de.common.loading : de.auth.resetButton}
      </Button>
    </form>
  );
}
