import type { Issue } from "../domain/importer.ts";
import type { SubmissionSummary } from "../domain/submission.ts";
import { OUTCOMES } from "../domain/versions.ts";

/**
 * What the page knows after trying to confirm an upload.
 *
 * - `submitted`: the server confirmed it (or had already, for a retry).
 * - `refused`: the server answered clearly that it did not store it.
 * - `uncertain`: no usable answer. The upload may have committed, for
 *   example when the connection dropped while the response was read. Retrying
 *   with the same file and receipt is safe and settles it.
 */
export type ConfirmOutcome =
  | { kind: "submitted"; replayed: boolean; submission: SubmissionSummary }
  | { kind: "refused"; issues: Issue[] }
  | { kind: "uncertain"; message: string };

export type WithdrawOutcome =
  | { kind: "withdrawn"; alreadyWithdrawn: boolean; submission: SubmissionSummary }
  | { kind: "refused"; issues: Issue[] }
  | { kind: "uncertain"; message: string };

export type StatusOutcome =
  | { kind: "found"; submission: SubmissionSummary }
  | { kind: "refused"; issues: Issue[] }
  | { kind: "failed"; message: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

export function isSubmissionSummary(value: unknown): value is SubmissionSummary {
  if (!isObject(value)) return false;
  const { status, createdAt, withdrawnAt, rowCount, rejected, outcomes } = value;
  return (
    (status === "completed" || status === "withdrawn") &&
    isCount(createdAt) &&
    (status === "completed" ? withdrawnAt === null : isCount(withdrawnAt)) &&
    isCount(rowCount) &&
    isCount(rejected) &&
    isObject(outcomes) &&
    OUTCOMES.every((outcome) => isCount(outcomes[outcome]))
  );
}

function isIssues(value: unknown): value is Issue[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((issue) => isObject(issue) && typeof issue.code === "string" && typeof issue.message === "string")
  );
}

/** Reads a JSON body, or null if it can't be read or parsed (a dropped connection, a truncated body). */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Sends a request that changes something and is safe to repeat. Never
 * throws: a success with a valid body is returned as `success` maps it, a
 * well-formed 4xx refusal is final, and anything else (a failed request,
 * a 5xx, a body that can't be read or doesn't validate) is `uncertain`,
 * because the change may have happened.
 */
async function idempotentRequest<T>(
  path: string,
  init: RequestInit,
  success: (body: Record<string, unknown>) => T | null,
): Promise<T | { kind: "refused"; issues: Issue[] } | { kind: "uncertain"; message: string }> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    return { kind: "uncertain", message: describe(error) };
  }
  const body = await readJson(response);
  if (response.status === 200 || response.status === 201) {
    const result = isObject(body) && body.ok === true ? success(body) : null;
    return result ?? { kind: "uncertain", message: `The answer couldn't be read (${response.status}).` };
  }
  if (response.status >= 400 && response.status < 500 && isObject(body) && body.ok === false && isIssues(body.issues)) {
    return { kind: "refused", issues: body.issues };
  }
  return { kind: "uncertain", message: `The server didn't answer clearly (${response.status}).` };
}

/**
 * Confirms a checked file. The receipt is the idempotency key, so anything
 * short of a clear answer is `uncertain` and the caller offers a retry with
 * the same file and receipt.
 */
export function confirmUpload(file: File, secret: string): Promise<ConfirmOutcome> {
  return idempotentRequest(
    "/api/submissions",
    { method: "POST", headers: { "content-type": "text/csv", authorization: `Receipt ${secret}` }, body: file },
    (body) =>
      typeof body.replayed === "boolean" && isSubmissionSummary(body.submission)
        ? { kind: "submitted" as const, replayed: body.replayed, submission: body.submission }
        : null,
  );
}

/** Withdrawing is idempotent, so an uncertain outcome can be retried. */
export function withdrawUpload(secret: string): Promise<WithdrawOutcome> {
  return idempotentRequest(
    "/api/submission/withdraw",
    { method: "POST", headers: { authorization: `Receipt ${secret}` } },
    (body) =>
      typeof body.alreadyWithdrawn === "boolean" &&
      isSubmissionSummary(body.submission) &&
      body.submission.status === "withdrawn"
        ? { kind: "withdrawn" as const, alreadyWithdrawn: body.alreadyWithdrawn, submission: body.submission }
        : null,
  );
}

export async function submissionStatus(secret: string, signal?: AbortSignal): Promise<StatusOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/submission", { headers: { authorization: `Receipt ${secret}` }, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: "failed", message: describe(error) };
  }
  const body = await readJson(response);
  if (response.status === 200 && isObject(body) && body.ok === true && isSubmissionSummary(body.submission)) {
    return { kind: "found", submission: body.submission };
  }
  if (response.status >= 400 && response.status < 500 && isObject(body) && body.ok === false && isIssues(body.issues)) {
    return { kind: "refused", issues: body.issues };
  }
  return { kind: "failed", message: `The server didn't answer clearly (${response.status}).` };
}
