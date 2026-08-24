/**
 * Thin caller over the tRPC HTTP endpoints, for clients that cannot use the
 * tRPC React bindings — the planned Raycast extension and Chrome extension.
 * The web client uses `@trpc/react-query` instead.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(message: string, code: string, httpStatus: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type ApiClientOptions = {
  /** Origin of the server, e.g. `https://api.tracktime.trebeljahr.com`. */
  baseUrl: string;
  /** `tt_…` API token. Omit to fall back to cookie auth. */
  token?: string;
  fetchImpl?: typeof fetch;
};

export type ApiClient = {
  query<TResult>(path: string, input?: unknown): Promise<TResult>;
  mutate<TResult>(path: string, input?: unknown): Promise<TResult>;
};

type TrpcEnvelope = {
  result?: { data?: unknown };
  error?: { message?: string; data?: { code?: string } };
};

const unwrap = (body: unknown, httpStatus: number): unknown => {
  if (typeof body !== "object" || body === null) {
    throw new ApiError("Malformed API response", "PARSE_ERROR", httpStatus);
  }
  const envelope = body as TrpcEnvelope;
  if (envelope.error) {
    throw new ApiError(
      envelope.error.message ?? "Request failed",
      envelope.error.data?.code ?? "INTERNAL_SERVER_ERROR",
      httpStatus
    );
  }
  return envelope.result?.data;
};

export const createApiClient = ({
  baseUrl,
  token,
  fetchImpl,
}: ApiClientOptions): ApiClient => {
  const doFetch =
    fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch?.bind(globalThis);

  if (!doFetch) {
    throw new Error("No fetch implementation available — pass `fetchImpl`.");
  }

  const headers = (): Record<string, string> => {
    const base: Record<string, string> = { "content-type": "application/json" };
    if (token) base.authorization = `Bearer ${token}`;
    return base;
  };

  const call = async <TResult>(
    path: string,
    input: unknown,
    method: "GET" | "POST"
  ): Promise<TResult> => {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/trpc/${path}`);
    if (method === "GET" && input !== undefined) {
      url.searchParams.set("input", JSON.stringify(input));
    }

    const response = await doFetch(url.toString(), {
      method,
      headers: headers(),
      // Cookie auth for same-site browser callers; harmless with a token.
      credentials: token ? "omit" : "include",
      body: method === "POST" ? JSON.stringify(input ?? {}) : undefined,
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(
        `Request to ${path} failed (${response.status})`,
        "PARSE_ERROR",
        response.status
      );
    }

    return unwrap(body, response.status) as TResult;
  };

  return {
    query: (path, input) => call(path, input, "GET"),
    mutate: (path, input) => call(path, input, "POST"),
  };
};
