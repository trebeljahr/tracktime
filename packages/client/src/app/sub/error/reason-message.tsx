"use client";

import { useSearchParams } from "next/navigation";

const MESSAGES: Record<string, string> = {
  missing: "The confirmation link was missing its token. Try subscribing again.",
  malformed: "The confirmation link is malformed. Try subscribing again.",
  bad_signature: "The confirmation link is invalid. Try subscribing again.",
  expired: "This confirmation link has expired. Please resubscribe to get a fresh one.",
  list_add_failed:
    "Something went wrong on our end while adding you to the list. Please try again.",
};

const FALLBACK = "We couldn't confirm your subscription. Please try again.";

/**
 * Read as a client-side search param rather than `await searchParams`: the
 * app is built with `output: "export"`, where a page that awaits
 * searchParams cannot be prerendered.
 */
export function ReasonMessage() {
  const reason = useSearchParams().get("reason");
  const message = (reason && MESSAGES[reason]) ?? FALLBACK;

  return <p className="mt-4 text-gray-600">{message}</p>;
}
