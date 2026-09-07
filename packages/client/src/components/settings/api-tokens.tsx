"use client";

import * as React from "react";
import { KeyRound, Plus } from "lucide-react";
import { apiTokenDisplayId, type ApiTokenSummary } from "@starter/shared";

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
import { CreateApiTokenDialog } from "./create-api-token-dialog";

/**
 * Absolute dates, not "3 days ago".
 *
 * A session is minutes old and reads best relatively; a token lives for months
 * and the question people actually ask of it is "which day does this stop
 * working", which a relative string cannot answer.
 */
export const formatDay = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export type ApiTokenState = "active" | "expired" | "revoked";

/**
 * Which of the three states a token is in.
 *
 * Expiry is derived rather than stored, so a token that lapsed overnight reads
 * as expired on the next render without anything having written to it.
 */
export function apiTokenState(
  token: ApiTokenSummary,
  now: number = Date.now(),
): ApiTokenState {
  if (token.revokedAt !== null) return "revoked";
  if (token.expiresAt !== null && Date.parse(token.expiresAt) <= now) {
    return "expired";
  }
  return "active";
}

// ── revoke dialog ────────────────────────────────────────────────────

type RevokeApiTokenDialogProps = {
  token: ApiTokenSummary | null;
  onOpenChange: (open: boolean) => void;
};

function RevokeApiTokenDialog({
  token,
  onOpenChange,
}: RevokeApiTokenDialogProps): React.JSX.Element {
  const utils = trpc.useUtils();

  const revoke = trpc.apiTokens.revoke.useMutation({
    onMutate: async ({ id }) => {
      await utils.apiTokens.list.cancel();
      const previous = utils.apiTokens.list.getData();
      // Revoked rather than removed — the row stays so the list can still say
      // this token existed and when it was turned off.
      utils.apiTokens.list.setData(undefined, (old) =>
        old?.map((item) =>
          item.id === id
            ? { ...item, revokedAt: new Date().toISOString() }
            : item,
        ),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        utils.apiTokens.list.setData(undefined, context.previous);
      }
      toast.error(error.message || "Could not revoke that token");
    },
    onSuccess: () => {
      toast.success("Token revoked.");
    },
    onSettled: () => {
      void utils.apiTokens.list.invalidate();
    },
  });

  return (
    <Dialog open={token !== null} onOpenChange={onOpenChange}>
      <DialogContent data-testid="revoke-api-token-dialog">
        <DialogHeader>
          <DialogTitle>Revoke {token?.name ?? "this token"}?</DialogTitle>
          <DialogDescription>
            Anything still using it starts getting refused on its next request.
            Nothing it already recorded is lost, and the row stays here so you
            can see it was turned off.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="revoke-api-token-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => {
              if (!token) return;
              revoke.mutate({ id: token.id, originId: ORIGIN_ID });
              onOpenChange(false);
            }}
            data-testid="revoke-api-token-confirm"
          >
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── panel ────────────────────────────────────────────────────────────

/**
 * The credentials scripts and integrations use.
 *
 * Deliberately separate from Devices &amp; apps: those are the apps you signed
 * in from, this is a key you hand to something that cannot sign in at all.
 */
export function ApiTokensPanel(): React.JSX.Element {
  const tokensQuery = trpc.apiTokens.list.useQuery();
  const [creating, setCreating] = React.useState(false);
  const [revoking, setRevoking] = React.useState<ApiTokenSummary | null>(null);

  const tokens = tokensQuery.data ?? [];

  return (
    <Card data-testid="settings-api-tokens">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>API tokens</CardTitle>
          <CardDescription>
            Keys for scripts, CI jobs and other tools that talk to the REST API
            instead of signing in. Each one is bound to this workspace and can
            never see more than you can. This list is yours alone — colleagues
            neither see nor can revoke the tokens you create here.
          </CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setCreating(true)}
          data-testid="create-api-token"
        >
          <Plus className="size-4" />
          New token
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {tokensQuery.isLoading ? (
          <div className="space-y-2" data-testid="api-tokens-loading">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : tokens.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No API tokens"
            description="Create one when something needs to read or write your time without a browser."
            testId="api-tokens-empty"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table data-testid="api-tokens-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Can do</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => {
                  const state = apiTokenState(token);
                  return (
                    <TableRow
                      key={token.id}
                      className={state === "active" ? undefined : "opacity-60"}
                      data-testid={`api-token-row-${token.id}`}
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                          {token.name}
                          {state === "revoked" ? (
                            <Badge
                              variant="secondary"
                              data-testid={`api-token-revoked-${token.id}`}
                            >
                              Revoked
                            </Badge>
                          ) : null}
                          {state === "expired" ? (
                            <Badge
                              variant="secondary"
                              data-testid={`api-token-expired-${token.id}`}
                            >
                              Expired
                            </Badge>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                          {apiTokenDisplayId(token.prefix)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {token.scopes.length === 0 ? (
                          <Badge
                            variant="outline"
                            data-testid={`api-token-no-access-${token.id}`}
                          >
                            Nothing
                          </Badge>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {token.scopes.map((scope) => (
                              <Badge
                                key={scope}
                                variant="outline"
                                className="font-mono"
                              >
                                {scope}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDay(token.createdAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {token.lastUsedAt ? formatDay(token.lastUsedAt) : "Never"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {token.expiresAt ? formatDay(token.expiresAt) : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={state === "revoked"}
                          onClick={() => setRevoking(token)}
                          data-testid={`revoke-api-token-${token.id}`}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <UsingATokenHint />
      </CardContent>

      <CreateApiTokenDialog open={creating} onOpenChange={setCreating} />
      <RevokeApiTokenDialog
        token={revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
      />
    </Card>
  );
}

/** The half nobody can guess: how the token is actually presented. */
function UsingATokenHint(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
      data-testid="api-token-hint"
    >
      <p className="font-medium text-foreground">Using a token</p>
      <p className="mt-1">
        Send it as{" "}
        <code className="font-mono text-foreground">
          Authorization: Bearer &lt;token&gt;
        </code>{" "}
        on requests to the REST API. Keep it in a secret store — anything
        holding it can act with the permissions ticked above.
      </p>
    </div>
  );
}
