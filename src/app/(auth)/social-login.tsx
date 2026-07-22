"use client";

import { useActionState } from "react";
import { signInWithProviderAction } from "./actions";
import { Button } from "@/components/ui/button";
import { de } from "@/lib/i18n/de";

/**
 * SSO buttons (Google / Facebook) shared by the login and register forms —
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
          value="facebook"
          variant="outline"
          className="w-full"
          disabled={pending}
        >
          <FacebookIcon />
          {de.auth.continueWithFacebook}
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

/** Facebook "f" mark (official brand blue). */
function FacebookIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07c0 6.02 4.39 11.01 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8v8.44C19.61 23.08 24 18.09 24 12.07Z"
      />
    </svg>
  );
}
