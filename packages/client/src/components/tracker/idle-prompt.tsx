"use client";

import * as React from "react";
import { Coffee } from "lucide-react";
import { formatIdleSpan, type IdleAnswer, type PendingIdle } from "@starter/core";

import { Button } from "@/components/ui/button";

export type IdlePromptProps = {
  pending: PendingIdle;
  /** How the idle start reads on the user's clock, e.g. "14:05". */
  since: string;
  onAnswer: (answer: IdleAnswer) => void;
};

/**
 * The idle prompt, rendered inside a sonner toast.
 *
 * Sibling of the sub-minute "Discard" offer: same surface, same "nothing
 * happens unless you say so" contract. It needs its own body only because
 * there are three honest answers to "you were away" and a toast action bar
 * holds two.
 *
 * The wording leads with what is being *offered*, not with an accusation —
 * reading, a meeting and a phone call are all real work that looks exactly
 * like this, so "keep it" has to be as easy to reach as discarding.
 */
export function IdlePrompt({
  pending,
  since,
  onAnswer,
}: IdlePromptProps): React.JSX.Element {
  const span = formatIdleSpan(pending.idleSec);

  return (
    <div
      className="flex w-full flex-col gap-3 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg"
      data-testid="idle-prompt"
      data-idle-started-at={pending.idleStartedAt}
    >
      <div className="flex items-start gap-3">
        <Coffee className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium leading-none">
            {pending.signal === "locked"
              ? `Screen locked for ${span}`
              : `No input for ${span}`}
          </p>
          <p className="text-sm text-muted-foreground">
            The timer has been running since {since}. Keep that time if you
            were reading, in a meeting or on a call.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onAnswer("keep")}
          data-testid="idle-keep"
        >
          I was working
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onAnswer("discard")}
          data-testid="idle-discard"
        >
          Discard {span}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => onAnswer("discard-and-resume")}
          data-testid="idle-discard-resume"
        >
          Discard and resume
        </Button>
      </div>
    </div>
  );
}
