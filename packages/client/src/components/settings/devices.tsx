"use client";

import * as React from "react";
import {
  Globe,
  Laptop,
  MonitorSmartphone,
  Puzzle,
  Smartphone,
  Sparkles,
  Terminal,
} from "lucide-react";
import type { ClientKind, DeviceSession } from "@starter/shared";

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

const CLIENT_ICONS: Record<ClientKind, typeof Laptop> = {
  web: Globe,
  desktop: Laptop,
  mobile: Smartphone,
  raycast: Sparkles,
  extension: Puzzle,
  cli: Terminal,
  unknown: MonitorSmartphone,
};

/** "3 minutes ago" — sessions are short-lived enough that relative reads best. */
const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Unknown";

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "Just now";

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86_400],
    ["month", 2_592_000],
    ["year", 31_536_000],
  ];

  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let divisor = 60;
  for (const [candidate, size] of units) {
    if (seconds < size * 60 || candidate === "year") {
      unit = candidate;
      divisor = size;
      break;
    }
  }

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return formatter.format(-Math.round(seconds / divisor), unit);
};

// ── sign-out dialog ──────────────────────────────────────────────────

type RevokeDeviceDialogProps = {
  device: DeviceSession | null;
  onOpenChange: (open: boolean) => void;
};

function RevokeDeviceDialog({
  device,
  onOpenChange,
}: RevokeDeviceDialogProps): React.JSX.Element {
  const utils = trpc.useUtils();

  const revokeMutation = trpc.devices.revoke.useMutation({
    onMutate: async ({ id }) => {
      await utils.devices.list.cancel();
      const previous = utils.devices.list.getData();
      utils.devices.list.setData(undefined, (old) =>
        old?.filter((item) => item.id !== id),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        utils.devices.list.setData(undefined, context.previous);
      }
      toast.error(error.message || "Could not sign that device out");
    },
    onSuccess: () => {
      toast.success("Device signed out.");
    },
    onSettled: () => {
      void utils.devices.list.invalidate();
    },
  });

  return (
    <Dialog open={device !== null} onOpenChange={onOpenChange}>
      <DialogContent data-testid="revoke-device-dialog">
        <DialogHeader>
          <DialogTitle>Sign out {device?.name ?? "this device"}?</DialogTitle>
          <DialogDescription>
            That client stops syncing immediately and has to sign in again.
            Nothing it already tracked is lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="revoke-device-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={revokeMutation.isPending}
            onClick={() => {
              if (!device) return;
              revokeMutation.mutate({ id: device.id, originId: ORIGIN_ID });
              onOpenChange(false);
            }}
            data-testid="revoke-device-confirm"
          >
            Sign out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── panel ────────────────────────────────────────────────────────────

/**
 * Every app signed in as you. There is no separate credential to hand out —
 * each client signs in the ordinary way and shows up here.
 */
export function DevicesPanel(): React.JSX.Element {
  const devicesQuery = trpc.devices.list.useQuery();
  const utils = trpc.useUtils();
  const [revoking, setRevoking] = React.useState<DeviceSession | null>(null);

  const devices = devicesQuery.data ?? [];
  const others = devices.filter((device) => !device.current).length;

  const revokeOthers = trpc.devices.revokeOthers.useMutation({
    onError: (error) => {
      toast.error(error.message || "Could not sign the other devices out");
    },
    onSuccess: ({ revoked }) => {
      toast.success(
        revoked === 1 ? "1 device signed out." : `${revoked} devices signed out.`,
      );
    },
    onSettled: () => {
      void utils.devices.list.invalidate();
    },
  });

  return (
    <Card data-testid="settings-devices">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Devices &amp; apps</CardTitle>
          <CardDescription>
            Everything signed in as you. Sign in from the desktop app, the
            mobile app, Raycast or a browser extension and it appears here —
            there is nothing to copy or paste.
          </CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={others === 0 || revokeOthers.isPending}
          onClick={() => revokeOthers.mutate({ originId: ORIGIN_ID })}
          data-testid="revoke-other-devices"
        >
          Sign out others
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {devicesQuery.isLoading ? (
          <div className="space-y-2" data-testid="devices-loading">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : devices.length === 0 ? (
          <EmptyState
            icon={MonitorSmartphone}
            title="No other devices"
            description="Sign in from another app and it will show up here."
            testId="devices-empty"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table data-testid="devices-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Signed in</TableHead>
                  <TableHead>Last active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((device) => {
                  const Icon = CLIENT_ICONS[device.client];
                  return (
                    <TableRow
                      key={device.id}
                      data-testid={`device-row-${device.id}`}
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          {device.name}
                          {device.current ? (
                            <Badge
                              variant="secondary"
                              data-testid="device-current-badge"
                            >
                              This device
                            </Badge>
                          ) : null}
                        </span>
                        {device.ipAddress ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {device.ipAddress}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatRelative(device.createdAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatRelative(device.updatedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={device.current}
                          onClick={() => setRevoking(device)}
                          data-testid={`revoke-device-${device.id}`}
                        >
                          Sign out
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <ConnectAnAppHint />
      </CardContent>

      <RevokeDeviceDialog
        device={revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
      />
    </Card>
  );
}

/** Points at the pairing page, which is the non-obvious half of the flow. */
function ConnectAnAppHint(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
      data-testid="connect-app-hint"
    >
      <p className="font-medium text-foreground">Connecting Raycast or a CLI</p>
      <p className="mt-1">
        Apps that cannot show a sign-in form give you a short code instead.
        Open{" "}
        <a
          className="font-medium text-foreground underline underline-offset-4"
          href="/device"
        >
          /device
        </a>{" "}
        while signed in here and enter it — the app is then signed in as you and
        appears in the list above.
      </p>
    </div>
  );
}
