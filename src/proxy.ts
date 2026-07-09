import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/shared/csp";

const PROTECTED_PREFIXES = ["/app", "/admin"];
const AUTH_PAGES = ["/login", "/registrieren", "/passwort-vergessen"];

/**
 * Refreshes the Supabase session cookie on every request, gates the app/admin
 * areas on authentication, and emits a per-request CSP nonce. Role checks
 * (admin) happen in the layouts on top of RLS — the proxy only guarantees a
 * session.
 */
export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = buildCsp(
    nonce,
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NODE_ENV !== "production",
  );

  // Next.js reads the nonce from the CSP *request* header and stamps it onto
  // its own script tags; `x-nonce` lets our components read it if needed.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const nextOptions = { request: { headers: requestHeaders } };
  let response = NextResponse.next(nextOptions);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without Supabase configuration there is no session to refresh or gate on.
  // Public pages must still render (and E2E specs must still boot the server);
  // protected pages fail closed via requireProfile() in their layouts.
  if (!supabaseUrl || !supabaseKey) {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next(nextOptions);
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  const withCsp = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  if (!user && PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return withCsp(NextResponse.redirect(new URL("/login", request.url)));
  }

  if (user && AUTH_PAGES.includes(path)) {
    return withCsp(NextResponse.redirect(new URL("/app", request.url)));
  }

  return withCsp(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
