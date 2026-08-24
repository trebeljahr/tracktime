"use client";

import * as React from "react";

/**
 * Wall-clock milliseconds, re-rendering every `intervalMs`. Drives the "now"
 * line and any block whose end is "still running".
 */
export const useNow = (intervalMs: number): number => {
  const [now, setNow] = React.useState<number>(() => Date.now());

  React.useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return now;
};
