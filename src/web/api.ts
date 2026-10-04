import type { Issue } from "../domain/importer.ts";
import type { SubmissionSummary } from "../domain/submission.ts";

export type SubmitResponse =
  | { ok: true; replayed: boolean; submission: SubmissionSummary }
  | { ok: false; issues: Issue[] };

export type StatusResponse = { ok: true; submission: SubmissionSummary } | { ok: false; issues: Issue[] };

function isApiBody(value: unknown): value is { ok: boolean } {
  return typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean";
}

/** Raised for failures where retrying with the same receipt is safe and may succeed. */
export class RetryableError extends Error {}

async function read<T>(response: Response): Promise<T> {
  if (response.status >= 500) throw new RetryableError(`The server failed (${response.status}).`);
  const body: unknown = await response.json();
  if (!isApiBody(body)) throw new RetryableError(`Unexpected response (${response.status}).`);
  return body as T;
}

/**
 * Confirms a checked file. The receipt is the idempotency key: sending the
 * same file with the same receipt again can't count it twice.
 */
export async function submit(file: File, secret: string): Promise<SubmitResponse> {
  let response: Response;
  try {
    response = await fetch("/api/submissions", {
      method: "POST",
      headers: { "content-type": "text/csv", authorization: `Receipt ${secret}` },
      body: file,
    });
  } catch (error) {
    throw new RetryableError(error instanceof Error ? error.message : String(error));
  }
  return read<SubmitResponse>(response);
}

export async function submissionStatus(secret: string): Promise<StatusResponse> {
  const response = await fetch("/api/submission", { headers: { authorization: `Receipt ${secret}` } });
  return read<StatusResponse>(response);
}
