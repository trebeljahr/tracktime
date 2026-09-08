/**
 * What to say when a child process of a build script exits non-zero.
 *
 * Its own module because the interesting part is pure text formatting and the
 * build script itself cannot be unit-tested (it spawns real builds and exits
 * the process). `scripts/lib/child-failure.test.mjs` covers it.
 *
 * The problem it solves: `\`pnpm build:client\` exited with 1` is true and
 * useless. It reads identically whether the code does not compile or whether
 * the machine hit `EMFILE` because three agents were building at once — and
 * the difference decides whether you debug or just run it again. The child's
 * stderr is streamed live *and* captured, so the tail can be repeated right
 * next to the failure instead of being however many hundred lines up the
 * scrollback.
 */

/** How many trailing stderr lines to repeat under the failure line. */
export const STDERR_TAIL_LINES = 20;

/**
 * The last `limit` non-empty lines of a child's stderr, trimmed.
 * Empty string when there is nothing worth showing.
 */
export const stderrTail = (stderr, limit = STDERR_TAIL_LINES) => {
  if (typeof stderr !== "string" || stderr.trim() === "") return "";
  const lines = stderr
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "");
  return lines.slice(-limit).join("\n");
};

/**
 * The message for a failed child process.
 *
 * `signal` is reported by name — a build killed by `SIGKILL` is the OOM killer
 * or a `kill -9`, which is a different conversation from a compile error, and
 * "exited with a signal" said neither which signal nor that it was one worth
 * distinguishing.
 */
export const describeChildFailure = ({
  command,
  args = [],
  status = null,
  signal = null,
  stderr = "",
}) => {
  const invocation = [command, ...args].join(" ");
  const how =
    signal !== null && signal !== undefined
      ? `was killed by ${signal}`
      : status === null || status === undefined
        ? "exited without a status"
        : `exited with ${status}`;

  const tail = stderrTail(stderr);
  if (tail === "") {
    return (
      `\`${invocation}\` ${how}, and wrote nothing to stderr.\n` +
      "  Whatever went wrong is in the output above, if anywhere."
    );
  }

  return (
    `\`${invocation}\` ${how}. Its last stderr lines:\n\n` +
    tail
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n")
  );
};
