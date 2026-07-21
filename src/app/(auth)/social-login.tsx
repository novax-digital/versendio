"use client";

import { useActionState } from "react";
import { signInWithProviderAction } from "./actions";
import { Button } from "@/components/ui/button";
import { de } from "@/lib/i18n/de";

/**
 * SSO buttons (Google / Microsoft) shared by the login and register forms —
 * OAuth makes no distinction between the two. One form, two submit buttons:
 * the clicked button's name/value carries the provider to the action, which
 * redirects to the provider's consent screen.
 */
export function SocialLogin() {
  const [state, formAction, pending] = useActionState(signInWithProviderAction, null);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-2">
        <Button
          type="submit"
          name="provider"
          value="google"
          variant="outline"
          className="w-full"
          disabled={pending}
        >
          <GoogleIcon />
          {de.auth.continueWithGoogle}
        </Button>
        <Button
          type="submit"
          name="provider"
          value="azure"
          variant="outline"
          className="w-full"
          disabled={pending}
        >
          <MicrosoftIcon />
          {de.auth.continueWithMicrosoft}
        </Button>
        {state && !state.ok && state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
      </form>

      <div className="text-muted-foreground flex items-center gap-3 text-xs">
        <span className="bg-border h-px flex-1" aria-hidden />
        {de.auth.ssoDivider}
        <span className="bg-border h-px flex-1" aria-hidden />
      </div>
    </div>
  );
}

/** Official Google "G" mark (brand colors are part of the sign-in guidelines). */
function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28a7.21 7.21 0 0 1 0-4.56V6.61H1.27a12 12 0 0 0 0 10.78l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}

/** Microsoft four-square mark. */
function MicrosoftIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
      <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
      <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
      <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
    </svg>
  );
}
