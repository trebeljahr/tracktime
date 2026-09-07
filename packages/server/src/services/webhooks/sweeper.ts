// The background loop that drains the delivery queue.
//
// Deliberately a timer over an indexed query rather than a job runner: the
// queue is one collection with a `{ status, nextAttemptAt }` index, and adding
// a broker to this would be a second thing to operate for a workload measured
// in events per minute.
import { env } from "../../config/env.js";
import { runWebhookSweep } from "./delivery.js";

/** How often the queue is checked. Cheap: it is one indexed query. */
export const WEBHOOK_SWEEP_INTERVAL_MS = 10_000;

let timer: NodeJS.Timeout | null = null;

/**
 * True while a pass is in flight.
 *
 * The interval keeps firing while a sweep is waiting on a slow endpoint, and
 * without this guard those passes stack up: each one claims its own batch and
 * the process ends up holding far more concurrent requests than
 * `WEBHOOK_SWEEP_BATCH` implies.
 */
let sweeping = false;

/**
 * Start the delivery loop.
 *
 * Returns immediately under NODE_ENV=test: a background timer in a test
 * process keeps the event loop alive and turns a passing suite into one that
 * hangs. `.unref()` for the same reason in every other environment — a
 * shutdown must not wait on the next tick of this.
 *
 * Idempotent, so a double call cannot start two loops racing for the same
 * pending rows.
 */
export function startWebhookSweeper(): void {
  if (env.isTest || timer) return;
  timer = setInterval(() => {
    void sweepOnce();
  }, WEBHOOK_SWEEP_INTERVAL_MS);
  timer.unref();
}

/**
 * One guarded pass.
 *
 * Swallows its own errors: a database blip must reschedule the next tick, not
 * kill the interval and silently stop every webhook in the deployment until
 * somebody restarts the process.
 */
async function sweepOnce(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    await runWebhookSweep();
  } catch {
    // Next tick tries again. See the doc comment.
  } finally {
    sweeping = false;
  }
}

/** Stop the loop. Called from the graceful-shutdown path. */
export function stopWebhookSweeper(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
