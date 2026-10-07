import type { Issue } from "../domain/importer.ts";
import { COVERAGES, ITEM_EXCLUSIONS, UNPLACED_REASONS, type ItemTotal, type Statistics } from "../domain/statistics.ts";
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

export type StatisticsOutcome =
  | { kind: "ok"; statistics: Statistics }
  | { kind: "refused"; issues: Issue[] }
  | { kind: "failed"; message: string };

const isAverage = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** An object with a count for every one of `keys`. */
function isCounts(value: unknown, keys: readonly string[]): boolean {
  return isObject(value) && keys.every((key) => isCount(value[key]));
}

function isItemTotal(value: unknown): value is ItemTotal {
  if (!isObject(value)) return false;
  const { item, quantity, averagePerObservation, multiplied, multipliedUnknown, levels } = value;
  return (
    typeof item === "string" &&
    isCount(quantity) &&
    isAverage(averagePerObservation) &&
    isCount(multiplied) &&
    isCount(multipliedUnknown) &&
    (levels === null || (Array.isArray(levels) && levels.length === 8 && levels.every(isCount)))
  );
}

/** Checks every field the dashboard reads, so a malformed answer fails cleanly instead of crashing the page. */
export function isStatistics(value: unknown): value is Statistics {
  if (!isObject(value)) return false;
  const { selection, records, items } = value;
  return (
    isObject(selection) &&
    isCount(selection.matched) &&
    isCounts(selection.unplaced, UNPLACED_REASONS) &&
    isObject(records) &&
    isCount(records.total) &&
    isCounts(records.byKind, ["hack", "drop"]) &&
    isCounts(records.byReadStatus, ["read", "notRead", "unavailable", "unsupported"]) &&
    isCounts(records.byCoverage, COVERAGES) &&
    isObject(items) &&
    (items.panels === "portal" || items.panels === "bonus" || items.panels === "both") &&
    isCount(items.eligible) &&
    isCounts(items.excluded, ITEM_EXCLUSIONS) &&
    isCount(items.totalQuantity) &&
    (items.averagePerObservation === null || isAverage(items.averagePerObservation)) &&
    Array.isArray(items.byItem) &&
    items.byItem.every(isItemTotal)
  );
}

/** `query` is a `statsQueryString`; the server validates it and refuses anything it can't read. */
export async function fetchStatistics(query: string, signal?: AbortSignal): Promise<StatisticsOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/statistics${query ? `?${query}` : ""}`, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: "failed", message: describe(error) };
  }
  const body = await readJson(response);
  if (response.status === 200 && isObject(body) && body.ok === true && isStatistics(body.statistics)) {
    return { kind: "ok", statistics: body.statistics };
  }
  if (response.status === 400 && isObject(body) && body.ok === false && isIssues(body.issues)) {
    return { kind: "refused", issues: body.issues };
  }
  return { kind: "failed", message: `The server didn't answer clearly (${response.status}).` };
}
