import { createAuthClient } from "better-auth/react";

/**
 * better-auth validates its baseURL with `new URL()`, so a relative
 * "/api/auth" throws. With `output: "export"` every page is prerendered in
 * Node — where there is no origin and NEXT_PUBLIC_API_URL may be unset — so
 * the URL has to be resolved defensively:
 *
 *  - NEXT_PUBLIC_API_URL when set (inlined at build time for the Docker
 *    image, the desktop bundle and the mobile bundle),
 *  - the live origin in the browser, which is what same-origin web
 *    deployments use,
 *  - a throwaway absolute URL during prerendering. No auth request is made
 *    while prerendering, and the client re-resolves against the real origin
 *    on hydration.
 */
function resolveAuthBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return `${configured}/api/auth`;

  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/auth`;
  }

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:5000/api/auth";
  }

  return "http://localhost/api/auth";
}

export const authClient = createAuthClient({
  baseURL: resolveAuthBaseUrl(),
});

// Re-export commonly used methods.
//
// `getSession` matters after sign-in and sign-up: it refreshes better-auth's
// session store before the app navigates. Without it the protected layout can
// read a still-empty session, decide the user is not authenticated, and bounce
// them straight back to /login even though the cookie was set correctly.
export const { signIn, signUp, signOut, useSession, getSession } = authClient;

/** Where a freshly authenticated user lands. */
export const POST_AUTH_REDIRECT = "/track";
