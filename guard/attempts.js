/** How many times this PR has already been through the guard. */

export function readAttempt(body) {
  if (!body) return null;
  const match = String(body).match(/<!-- kane-pr-guard-result attempt:(\d+) status:([a-z]+) -->/);
  if (!match) return null;
  return { attempt: Number(match[1]), status: match[2] };
}

export function nextAttempt(previous) {
  if (!previous || previous.status === "passed") return 1;
  return previous.attempt + 1;
}

/**
 * Ask the coding agent to push a fix only while attempts remain.
 * The run that hits the cap still reports the failure and then stops.
 */
export function shouldRequestFix(status, attempt, maxAttempts) {
  return status !== "passed" && attempt < maxAttempts;
}

export function stampResult(body, attempt, status) {
  const marker = `<!-- kane-pr-guard-result attempt:${attempt} status:${status} -->`;
  const stripped = String(body).replace(/<!-- kane-pr-guard-result attempt:\d+ status:[a-z]+ -->\n?/g, "");
  return `${marker}\n${stripped.trim()}\n`;
}

export function capNote(attempt, maxAttempts) {
  return `\n> Retry cap reached (${attempt}/${maxAttempts}). The last failure is left in place and no further fix request will be posted.\n`;
}

export function statusToExit(status) {
  if (status === "passed") return 0;
  if (status === "failed") return 1;
  if (status === "timeout") return 3;
  return 2;
}
