"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateProfileAction } from "./actions";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { de } from "@/lib/i18n/de";

type ProfileDefaults = {
  displayName: string;
  company: string;
  billingStreet: string;
  billingZip: string;
  billingCity: string;
  billingCountry: string;
};

export function ProfileForm({
  defaults,
  onSaved,
}: {
  defaults: ProfileDefaults;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) {
      toast.success(de.profile.saved);
      onSaved?.();
    } else if (state && !state.ok && state.error) {
      toast.error(state.error);
    }
  }, [state, onSaved]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormField
        label={de.auth.displayName}
        name="displayName"
        defaultValue={defaults.displayName}
        required
        error={fieldErrors?.displayName}
      />
      <FormField
        label={de.auth.company}
        name="company"
        defaultValue={defaults.company}
        optionalLabel={de.common.optional}
        error={fieldErrors?.company}
      />
      <fieldset className="space-y-4 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">{de.profile.billingAddress}</legend>
        <p className="text-muted-foreground text-xs">{de.profile.billingAddressHint}</p>
        <FormField
          label={de.profile.street}
          name="billingStreet"
          defaultValue={defaults.billingStreet}
          autoComplete="street-address"
          error={fieldErrors?.billingStreet}
        />
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <FormField
            label={de.profile.zip}
            name="billingZip"
            defaultValue={defaults.billingZip}
            autoComplete="postal-code"
            error={fieldErrors?.billingZip}
          />
          <FormField
            label={de.profile.city}
            name="billingCity"
            defaultValue={defaults.billingCity}
            autoComplete="address-level2"
            error={fieldErrors?.billingCity}
          />
        </div>
        <FormField
          label={de.profile.country}
          name="billingCountry"
          defaultValue={defaults.billingCountry}
          maxLength={2}
          hint={de.profile.countryHint}
          error={fieldErrors?.billingCountry}
        />
      </fieldset>
      <Button type="submit" disabled={pending}>
        {pending ? de.common.saving : de.common.save}
      </Button>
    </form>
  );
}
