"use client";

import * as React from "react";
import { Check, Copy, KeyRound, Loader2, Plus, ShieldAlert } from "lucide-react";
import type { ApiToken, CreatedApiToken } from "@starter/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { ORIGIN_ID } from "@/hooks/use-sync";
import { trpc } from "@/lib/trpc";

/** Base the snippet points at. Baked at build time, like every client env var. */
const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL !== ""
    ? process.env.NEXT_PUBLIC_API_URL
    : "https://your-tracktime-server";

const formatStamp = (iso: string | null): string => {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const copyToClipboard = async (value: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};

// ── usage snippet ────────────────────────────────────────────────────

/** Makes the point of the token obvious: it is a Bearer credential. */
function TokenUsageSnippet(): React.JSX.Element {
  const snippet = `curl -H "Authorization: Bearer tt_your_token_here" \\\n  ${API_BASE}/api/trpc/entries.current`;

  return (
    <div className="space-y-2" data-testid="token-usage-snippet">
      <p className="text-sm text-muted-foreground">
        Send the token as a Bearer credential on any API request — that is how
        the Raycast and browser extensions talk to tracktime.
      </p>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs leading-relaxed">
        <code>{snippet}</code>
      </pre>
    </div>
  );
}

// ── create dialog ────────────────────────────────────────────────────

type CreateTokenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function CreateTokenDialog({
  open,
  onOpenChange,
}: CreateTokenDialogProps): React.JSX.Element {
  const utils = trpc.useUtils();
  const [name, setName] = React.useState("");
  const [created, setCreated] = React.useState<CreatedApiToken | null>(null);
  const [copied, setCopied] = React.useState(false);

  const createMutation = trpc.tokens.create.useMutation({
    onMutate: async () => {
      await utils.tokens.list.cancel();
      return { previous: utils.tokens.list.getData() };
    },
    onSuccess: (token) => {
      // The plaintext value exists only in this response — hold it in local
      // state, never in the query cache, and show it exactly once.
      const { token: _plaintext, ...meta } = token;
      utils.tokens.list.setData(undefined, (old) =>
        old ? [meta, ...old] : [meta]
      );
      setCreated(token);
      setCopied(false);
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        utils.tokens.list.setData(undefined, context.previous);
      }
      toast.error(error.message || "Could not create the token");
    },
    onSettled: () => {
      void utils.tokens.list.invalidate();
    },
  });

  const close = (next: boolean): void => {
    onOpenChange(next);
    if (!next) {
      setName("");
      setCreated(null);
      setCopied(false);
    }
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      toast.error("Give the token a name so you can recognise it later.");
      return;
    }
    createMutation.mutate({ name: trimmed, originId: ORIGIN_ID });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        showCloseButton={created === null}
        data-testid="create-token-dialog"
      >
        {created === null ? (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Create API token</DialogTitle>
              <DialogDescription>
                A token acts on your behalf with full access to your time
                entries. Name it after the tool that will use it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="token-name">Token name</Label>
              <Input
                id="token-name"
                value={name}
                autoFocus
                maxLength={120}
                placeholder="Raycast on my laptop"
                onChange={(event) => setName(event.target.value)}
                data-testid="token-name-input"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => close(false)}
                data-testid="create-token-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                data-testid="create-token-submit"
              >
                {createMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Create token
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div data-testid="token-reveal">
            <DialogHeader>
              <DialogTitle>Copy your token now</DialogTitle>
              <DialogDescription>
                This is the only time <strong>{created.name}</strong> will ever
                be shown. tracktime stores only a hash — if you lose it you
                have to revoke it and create another.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={created.token}
                  aria-label="API token"
                  className="font-mono text-xs"
                  onFocus={(event) => event.currentTarget.select()}
                  data-testid="token-plaintext"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy token"
                  onClick={() => {
                    void copyToClipboard(created.token).then((ok) => {
                      setCopied(ok);
                      if (ok) toast.success("Token copied to clipboard.");
                      else
                        toast.error(
                          "Clipboard blocked — select the token and copy it manually."
                        );
                    });
                  }}
                  data-testid="token-copy"
                >
                  {copied ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
              <div
                className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                data-testid="token-warning"
              >
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="text-muted-foreground">
                  Treat it like a password. Anyone holding it can read and
                  change your time entries until you revoke it.
                </p>
              </div>
              <TokenUsageSnippet />
            </div>
            <DialogFooter>
              <Button
                type="button"
                onClick={() => close(false)}
                data-testid="token-saved-confirm"
              >
                I&rsquo;ve saved it
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── revoke dialog ────────────────────────────────────────────────────

type RevokeTokenDialogProps = {
  token: ApiToken | null;
  onOpenChange: (open: boolean) => void;
};

function RevokeTokenDialog({
  token,
  onOpenChange,
}: RevokeTokenDialogProps): React.JSX.Element {
  const utils = trpc.useUtils();

  const revokeMutation = trpc.tokens.revoke.useMutation({
    onMutate: async ({ id }) => {
      await utils.tokens.list.cancel();
      const previous = utils.tokens.list.getData();
      const revokedAt = new Date().toISOString();
      utils.tokens.list.setData(undefined, (old) =>
        old?.map((item) => (item.id === id ? { ...item, revokedAt } : item))
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        utils.tokens.list.setData(undefined, context.previous);
      }
      toast.error(error.message || "Could not revoke the token");
    },
    onSuccess: () => {
      toast.success("Token revoked.");
    },
    onSettled: () => {
      void utils.tokens.list.invalidate();
    },
  });

  return (
    <Dialog open={token !== null} onOpenChange={onOpenChange}>
      <DialogContent data-testid="revoke-token-dialog">
        <DialogHeader>
          <DialogTitle>Revoke {token?.name ?? "token"}?</DialogTitle>
          <DialogDescription>
            Any integration still using this token stops working immediately.
            The token stays in the list as a record and cannot be restored.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="revoke-token-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={revokeMutation.isPending}
            onClick={() => {
              if (!token) return;
              revokeMutation.mutate({ id: token.id, originId: ORIGIN_ID });
              onOpenChange(false);
            }}
            data-testid="revoke-token-confirm"
          >
            Revoke token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── panel ────────────────────────────────────────────────────────────

/** Personal access tokens — the entry point for the Raycast/Chrome clients. */
export function ApiTokensPanel(): React.JSX.Element {
  const tokensQuery = trpc.tokens.list.useQuery();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [revoking, setRevoking] = React.useState<ApiToken | null>(null);

  const tokens = tokensQuery.data ?? [];

  return (
    <Card data-testid="settings-tokens">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>API access</CardTitle>
          <CardDescription>
            Personal tokens let external tools — the Raycast extension, the
            browser extension, your own scripts — start and stop timers for you.
          </CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setCreateOpen(true)}
          data-testid="create-token"
        >
          <Plus className="size-4" />
          Create token
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {tokensQuery.isLoading ? (
          <div className="space-y-2" data-testid="tokens-loading">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : tokens.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No API tokens yet"
            description="Create one when you set up an extension or a script."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(true)}
                data-testid="create-token-empty"
              >
                <Plus className="size-4" />
                Create token
              </Button>
            }
            testId="tokens-empty"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table data-testid="tokens-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => {
                  const revoked = token.revokedAt !== null;
                  return (
                    <TableRow
                      key={token.id}
                      data-testid={`token-row-${token.id}`}
                      className={revoked ? "text-muted-foreground" : undefined}
                    >
                      <TableCell className="font-medium">
                        {token.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {token.prefix}…
                      </TableCell>
                      <TableCell>{formatStamp(token.createdAt)}</TableCell>
                      <TableCell>{formatStamp(token.lastUsedAt)}</TableCell>
                      <TableCell className="text-right">
                        {revoked ? (
                          <Badge
                            variant="outline"
                            data-testid={`token-revoked-${token.id}`}
                          >
                            Revoked
                          </Badge>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setRevoking(token)}
                            data-testid={`revoke-token-${token.id}`}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <TokenUsageSnippet />
      </CardContent>

      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} />
      <RevokeTokenDialog
        token={revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
      />
    </Card>
  );
}
