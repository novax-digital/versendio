"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { deleteAccountAction } from "./actions";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { de } from "@/lib/i18n/de";

export function DeleteAccountForm() {
  const [state, formAction, pending] = useActionState(deleteAccountAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormField
        label={de.profile.deleteAccountConfirmLabel}
        name="confirm"
        placeholder="LÖSCHEN"
        required
        error={fieldErrors?.confirm}
      />
      <FormField
        label={de.profile.currentPassword}
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={fieldErrors?.password}
      />
      {state && !state.ok && state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" variant="destructive" disabled={pending}>
        <Trash2 className="size-4" aria-hidden />
        {pending ? de.common.loading : de.profile.deleteAccountButton}
      </Button>
    </form>
  );
}
