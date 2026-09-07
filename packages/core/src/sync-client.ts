import {
  isSyncMessage,
  type ServerToClientMessage,
  type SyncEvent,
} from "@starter/shared";

export type SyncStatus = "connecting" | "open" | "closed";

export type SyncClientOptions = {
  /** Full ws:// or wss:// URL, e.g. `wss://example.com/api/ws`. */
  url: string;
  onEvent: (event: SyncEvent, originId?: string) => void;
  onStatus?: (status: SyncStatus) => void;
  /**
   * better-auth session token, for clients with no cookie (Raycast, the
   * extensions, the native shells). Obtain it from `signInWithPassword()` or
   * the device flow — there is no separate credential to mint.
   */
  token?: string;
  /** Injectable for Node tests and non-DOM hosts. */
  WebSocketImpl?: typeof WebSocket;
  minBackoffMs?: number;
  maxBackoffMs?: number;
};

export type SyncClient = {
  connect(): void;
  close(): void;
  status(): SyncStatus;
};

/** Subprotocol prefix the server reads the session token from. */
const BEARER_SUBPROTOCOL_PREFIX = "bearer.";

/**
 * The WebSocket constructor cannot set an Authorization header, so the token
 * rides in the subprotocol instead of the query string — a URL is the one
 * place it could end up in an access log or a referrer.
 */
const subprotocols = (token?: string): string[] | undefined =>
  token ? [`${BEARER_SUBPROTOCOL_PREFIX}${encodeURIComponent(token)}`] : undefined;

/**
 * WebSocket subscription to the signed-in user's sync room.
 *
 * Reconnects with jittered exponential backoff and never throws on a
 * malformed frame — a bad message must not take down the socket that
 * keeps every device's timer in agreement.
 */
export const createSyncClient = ({
  url,
  onEvent,
  onStatus,
  token,
  WebSocketImpl,
  minBackoffMs = 1000,
  maxBackoffMs = 30_000,
}: SyncClientOptions): SyncClient => {
  const SocketCtor =
    WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;

  let socket: WebSocket | null = null;
  let status: SyncStatus = "closed";
  let attempt = 0;
  let retryHandle: ReturnType<typeof setTimeout> | null = null;
  let closedByCaller = false;

  const setStatus = (next: SyncStatus): void => {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  };

  const backoffMs = (): number => {
    const exponential = Math.min(maxBackoffMs, minBackoffMs * 2 ** attempt);
    // Jitter so many devices waking at once don't reconnect in lockstep.
    return Math.round(exponential * (0.5 + Math.random() * 0.5));
  };

  const scheduleReconnect = (): void => {
    if (closedByCaller || retryHandle) return;
    const delay = backoffMs();
    attempt += 1;
    retryHandle = setTimeout(() => {
      retryHandle = null;
      open();
    }, delay);
  };

  const handleMessage = (raw: unknown): void => {
    if (typeof raw !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const message = parsed as ServerToClientMessage;
    if (!("type" in message) || !isSyncMessage(message)) return;
    try {
      onEvent(message.event, message.originId);
    } catch {
      // A throwing consumer must not kill the socket.
    }
  };

  const open = (): void => {
    if (!SocketCtor) {
      setStatus("closed");
      return;
    }
    if (socket) return;

    setStatus("connecting");
    try {
      const protocols = subprotocols(token);
      socket = protocols
        ? new SocketCtor(url, protocols)
        : new SocketCtor(url);
    } catch {
      socket = null;
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      attempt = 0;
      setStatus("open");
    };
    socket.onmessage = (event: MessageEvent) => handleMessage(event.data);
    socket.onerror = () => {
      /* the close handler drives reconnection */
    };
    socket.onclose = () => {
      socket = null;
      setStatus("closed");
      scheduleReconnect();
    };
  };

  return {
    connect: () => {
      closedByCaller = false;
      open();
    },
    close: () => {
      closedByCaller = true;
      if (retryHandle) {
        clearTimeout(retryHandle);
        retryHandle = null;
      }
      const current = socket;
      socket = null;
      current?.close();
      setStatus("closed");
    },
    status: () => status,
  };
};
