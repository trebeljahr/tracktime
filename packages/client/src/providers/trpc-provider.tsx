"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { trpc, getTRPCClient } from "@/lib/trpc";
import { bindOnlineManager, createAppQueryClient } from "@/lib/query-client";

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  // Before the client exists, so nothing can observe React Query's default
  // (browser-only) idea of whether the device is online. See lib/query-client.
  const [queryClient] = useState(() => {
    bindOnlineManager();
    return createAppQueryClient();
  });
  const [trpcClient] = useState(() => getTRPCClient());

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
