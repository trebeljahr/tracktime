// Meta routes: who am I, and what does this API look like.
import { buildOpenApiDocument } from "../openapi.js";
import type { ApiHandlers, PublicApiHandlers } from "../auth.js";
import { sendData } from "../envelope.js";
import type { ApiIdentity } from "../routes-table.js";

export const metaHandlers: ApiHandlers = {
  /**
   * The token's own view of itself.
   *
   * The visibility flags are the EFFECTIVE ones — live membership ANDed with
   * the ceiling the token was minted under — so a client can decide whether to
   * render a money column at all instead of discovering the answer from a 403
   * three screens later. No secret is echoed: the plaintext exists only at
   * mint time and this endpoint has never seen it.
   */
  "get /me": (req, res) => {
    const { tokenId, workspaceId, userId, scopes, visibility } = req.apiToken;
    const identity: ApiIdentity = {
      tokenId,
      workspaceId,
      userId,
      scopes,
      visibility: {
        canViewOthersTime: visibility.canViewOthersTime,
        canViewOthersMoney: visibility.canViewOthersMoney,
      },
    };
    sendData(res, identity);
  },
};

export const publicMetaHandlers: PublicApiHandlers = {
  /**
   * The spec, unauthenticated.
   *
   * Deliberately public: it describes shapes, never data, and a client
   * generator that needs a credential before it can even see the route list is
   * a client generator nobody runs. Built from the route table on each request
   * rather than cached, because it is a handful of milliseconds and a stale
   * cache after a deploy is a spec that documents the previous release.
   */
  "get /openapi.json": (_req, res) => {
    res.status(200).json(buildOpenApiDocument());
  },
};
