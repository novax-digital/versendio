"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { loginAction } from "../actions";
import { SocialLogin } from "../social-login";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { de } from "@/lib/i18n/de";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  // CONTROLLED fields: React resets uncontrolled inputs after a form action —
  // a wrong password must not wipe the typed e-mail address.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="space-y-4">
      <SocialLogin />
      <form action={formAction} className="space-y-4" noValidate>
        <FormField
          label={de.auth.email}
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors?.email}
        />
        <div className="space-y-1.5">
          <FormField
            label={de.auth.password}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors?.password}
          />
          <Link
            href="/passwort-vergessen"
            className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          >
            {de.auth.forgotPassword}
          </Link>
        </div>
        {state && !state.ok && state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? de.common.loading : de.auth.loginButton}
        </Button>
      </form>
    </div>
  );
}
