import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { organization } from "better-auth/plugins/organization";
import { MongoClient } from "mongodb";
import { env, getTrustedOrigins } from "../config/env.js";
import { sendEmail } from "../services/email.js";
import {
  DEVICE_FLOW_CLIENT_IDS,
  clientKindFromHeaders,
  normalizeClientKind,
} from "./client-label.js";
import { createPersonalWorkspace } from "./personal-workspace.js";

/**
 * better-auth instance. Must be initialized AFTER mongoose.connect() because
 * it uses the same MongoDB URI.
 *
 * We create a separate MongoClient (not from mongoose) to avoid the type
 * mismatch between mongoose's bundled mongodb driver and better-auth's.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _auth: any = null;
let _authClient: MongoClient | null = null;

export async function initAuth(): Promise<void> {
  _authClient = new MongoClient(env.MONGODB_URI);
  await _authClient.connect();
  const db = _authClient.db();

  _auth = betterAuth({
    database: mongodbAdapter(db),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: getTrustedOrigins(),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // Set to true once Listmonk + SES is configured
      async sendResetPassword({ user, url }: { user: { email: string }; url: string }) {
        if (!env.LISTMONK_URL || !env.LISTMONK_TX_TEMPLATE_ID) {
          console.log(`[auth] Password reset URL for ${user.email}: ${url}`);
          return;
        }
        await sendEmail({
          to: user.email,
          subject: "Reset your password",
          text: `Click this link to reset your password: ${url}`,
          html: `<p>Click <a href="${url}">here</a> to reset your password.</p>`,
        });
      },
      async sendVerificationEmail({ user, url }: { user: { email: string }; url: string }) {
        if (!env.LISTMONK_URL || !env.LISTMONK_TX_TEMPLATE_ID) {
          console.log(`[auth] Verification URL for ${user.email}: ${url}`);
          return;
        }
        await sendEmail({
          to: user.email,
          subject: "Verify your email",
          text: `Click this link to verify your email: ${url}`,
          html: `<p>Click <a href="${url}">here</a> to verify your email.</p>`,
        });
      },
    },

    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },

    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
      /**
       * `client` is what turns the raw session list into a readable
       * "Devices" screen. `input: false` keeps it out of the request body —
       * it is filled in by the databaseHooks below, from the request, so a
       * caller cannot write it directly.
       */
      additionalFields: {
        client: {
          type: "string",
          required: false,
          defaultValue: "unknown",
          input: false,
        },
      },
    },

    plugins: [
      /**
       * Lets any non-browser client (Raycast, the extensions, the desktop and
       * mobile shells) sign in normally and then carry its session as
       * `Authorization: Bearer <token>` instead of a cookie.
       *
       * Two token forms reach us and both must work: password sign-in returns
       * the *signed* token on the `set-auth-token` response header, while the
       * device flow returns the *raw* session token as `access_token` and
       * sets no such header. `requireSignature` would accept only the first
       * and break every device-paired client, so it stays off — which costs
       * nothing, because an unsigned value is signed with this server's own
       * secret and then looked up: an unknown token simply matches no session.
       */
      bearer(),

      /**
       * RFC 8628 device flow, for clients where typing a password is wrong:
       * Raycast and the CLI show a short code, the user approves it at
       * /device in an already-signed-in browser.
       */
      /**
       * Workspaces. One organization IS one tracktime workspace — the plugin
       * owns identity, membership, invitations and roles, while `workspaceId`
       * on the domain collections is what actually scopes data.
       *
       * `teams` stays OFF deliberately. The plugin's teams are a SECOND
       * nesting level inside an organization; tracktime's ownership scope is
       * one level deep. Enabling it would put two scope ids in every query and
       * two pickers in every UI — including a 360px extension popup — for a
       * grouping nobody has asked for. `teamId` is additive if that changes.
       */
      organization({
        // Personal workspaces are created for their owner by the signup hook
        // below, so the creator is always "owner".
        creatorRole: "owner",
        async sendInvitationEmail({
          email,
          invitation,
          organization: org,
          inviter,
        }: {
          email: string;
          invitation: { id: string };
          organization: { name: string };
          inviter: { user: { name?: string; email: string } };
        }) {
          const url = `${env.FRONTEND_URL.replace(/\/$/, "")}/invite/${invitation.id}`;
          const who = inviter.user.name || inviter.user.email;
          if (!env.LISTMONK_URL || !env.LISTMONK_TX_TEMPLATE_ID) {
            console.log(`[auth] Invitation URL for ${email}: ${url}`);
            return;
          }
          await sendEmail({
            to: email,
            subject: `${who} invited you to ${org.name}`,
            text: `${who} invited you to join ${org.name} on tracktime: ${url}`,
            html: `<p>${who} invited you to join <strong>${org.name}</strong> on tracktime.</p><p><a href="${url}">Accept the invitation</a></p>`,
          });
        },
      }),

      deviceAuthorization({
        expiresIn: "10m",
        interval: "5s",
        /**
         * The code is approved in the *web app*, which is a different origin
         * from this API in dev and in any split deployment. Without this,
         * better-auth points the user at the API's own /device, which does
         * not exist.
         */
        verificationUri: `${env.FRONTEND_URL.replace(/\/$/, "")}/device`,
        validateClient: (clientId: string) =>
          Object.hasOwn(DEVICE_FLOW_CLIENT_IDS, clientId),
      }),
    ],

    databaseHooks: {
      user: {
        create: {
          /**
           * Give every new user their personal workspace immediately, so the
           * "user with no workspace" state never exists and no resolver needs
           * a branch for it.
           *
           * Deliberately non-fatal: a signup must not fail because the
           * workspace could not be created. `ensurePersonalWorkspace` repairs
           * the gap on the next read.
           */
          after: async (user: { id: string; name?: string; email?: string }) => {
            await createPersonalWorkspace(getAuth().api, user);
          },
        },
      },

      session: {
        create: {
          /**
           * Stamp each new session with the client that created it, so the
           * devices list can say "Raycast" rather than guessing from a user
           * agent that non-browser clients barely set.
           *
           * Password sign-in carries `x-tracktime-client`; the device flow
           * carries `client_id` in the /device/token body. Cosmetic only.
           */
          before: async (session, context) => {
            const fromHeader = clientKindFromHeaders(
              context?.headers ?? context?.request?.headers,
            );
            const body: unknown = context?.body;
            const clientId =
              typeof body === "object" && body !== null
                ? (body as { client_id?: unknown }).client_id
                : undefined;
            const fromBody = normalizeClientKind(clientId);
            const client = fromHeader !== "unknown" ? fromHeader : fromBody;
            return { data: { ...session, client } };
          },
        },
      },
    },
  });
}

export function getAuth() {
  if (!_auth) {
    throw new Error(
      "Auth not initialized. Call initAuth() after database connection.",
    );
  }
  return _auth;
}

export async function disconnectAuth(): Promise<void> {
  if (_authClient) {
    await _authClient.close();
    _authClient = null;
  }
}
