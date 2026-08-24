import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { getAuth } from "../auth/auth.js";
import {
  extractBearerToken,
  resolveApiTokenPrincipal,
} from "../auth/api-token.js";
import { fromNodeHeaders } from "better-auth/node";

/**
 * How the caller proved who they are:
 *  - "session" — better-auth cookie (browser / desktop / mobile shells)
 *  - "token"   — `Authorization: Bearer tt_...` personal API token
 *  - null      — anonymous
 */
export type AuthMethod = "session" | "token" | null;

/**
 * Build the tRPC request context.
 *
 * The better-auth cookie session is the primary path and behaves exactly as
 * before. Only when there is no session do we fall back to a personal API
 * token, so a browser request can never be influenced by an Authorization
 * header it happens to carry.
 */
export async function createContext({ req, res }: CreateExpressContextOptions) {
  const auth = getAuth();
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (session?.user) {
    return {
      req,
      res,
      session,
      user: session.user,
      authMethod: "session" as const,
    };
  }

  const bearer = extractBearerToken(req.headers.authorization);
  const principal = bearer ? await resolveApiTokenPrincipal(bearer) : null;
  if (principal) {
    return {
      req,
      res,
      session: principal,
      user: principal.user,
      authMethod: "token" as const,
    };
  }

  return {
    req,
    res,
    session: null,
    user: null,
    authMethod: null,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
