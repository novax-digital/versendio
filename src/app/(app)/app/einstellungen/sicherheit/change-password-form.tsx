"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { changePasswordAction } from "../actions";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { de } from "@/lib/i18n/de";

export function ChangePasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(changePasswordAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) {
      toast.success(de.profile.changePasswordSuccess);
      formRef.current?.reset();
    } else if (state && !state.ok && state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4" noValidate>
      <FormField
        label={de.profile.currentPassword}
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        error={fieldErrors?.currentPassword}
      />
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
      <Button type="submit" disabled={pending}>
        {pending ? de.common.saving : de.common.save}
      </Button>
    </form>
  );
}
