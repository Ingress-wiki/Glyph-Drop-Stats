import { DEFAULT_LIMITS, makeIssue, parseExport } from "../domain/importer.ts";
import type { IssueKey, IssueParams } from "../domain/issueMessages.ts";
import { previewOf } from "../domain/preview.ts";
import { hashReceiptSecret, isReceiptSecret } from "../domain/receipt.ts";
import { parseStatsQuery } from "../domain/statsQuery.ts";
import { emptyOutcomeCounts } from "../domain/versions.ts";
import type { Db } from "./db.ts";
import { statistics } from "./statistics.ts";
import { classify, confirmSubmission, countOutcomes, findSubmission, withdrawSubmission } from "./submissions.ts";

export interface ApiEnv {
  DB: Db;
}

const NO_STORE = { "cache-control": "no-store" };

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function error(status: number, code: string, key: IssueKey, params?: IssueParams): Response {
  return json(status, { ok: false, issues: [makeIssue(code, key, params)] });
}

const tooLarge = () => error(413, "file_too_large", "file.tooLarge", { limit: DEFAULT_LIMITS.maxBytes });

/**
 * Reads the body into memory, giving up as soon as it passes `maxBytes`, so
 * a body without a Content-Length can't make the Worker buffer more.
 * Returns null when the body is too large.
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get("content-length") ?? "0") > maxBytes) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * The receipt travels in `Authorization: Receipt <secret>`, never in a URL,
 * so it doesn't end up in logs, history or referrers.
 */
function receiptSecret(request: Request): string | null {
  const match = /^Receipt (\S+)$/.exec(request.headers.get("authorization") ?? "");
  return match && isReceiptSecret(match[1]) ? match[1] : null;
}

/** Validates an export and compares it with accepted data. Nothing is stored. */
async function preview(request: Request, env: ApiEnv): Promise<Response> {
  const body = await readBodyLimited(request, DEFAULT_LIMITS.maxBytes);
  if (body === null) return tooLarge();
  const result = parseExport(body);
  if (!result.ok) return json(422, previewOf(result, emptyOutcomeCounts()));
  const classified = await classify(
    env.DB,
    result.records.map((entry) => entry.record),
  );
  return json(200, previewOf(result, countOutcomes(classified)));
}

/** Confirms an upload. The file is validated again here; the preview decided nothing. */
async function submit(request: Request, env: ApiEnv): Promise<Response> {
  const secret = receiptSecret(request);
  if (!secret) return error(400, "invalid_receipt", "api.invalidReceipt");
  const body = await readBodyLimited(request, DEFAULT_LIMITS.maxBytes);
  if (body === null) return tooLarge();
  const parsed = parseExport(body);
  if (!parsed.ok) return json(422, { ok: false, issues: parsed.issues });
  if (parsed.records.length === 0) {
    return error(422, "no_valid_records", "api.noValidRecords");
  }
  const result = await confirmSubmission(env.DB, {
    secret,
    fileBytes: body,
    parsed,
    now: Math.floor(Date.now() / 1000),
  });
  switch (result.kind) {
    case "created":
      return json(201, { ok: true, replayed: false, submission: result.summary });
    case "replayed":
      return json(200, { ok: true, replayed: true, submission: result.summary });
    case "receipt_in_use":
      return error(409, "receipt_in_use", "api.receiptInUse");
  }
}

async function status(request: Request, env: ApiEnv): Promise<Response> {
  const secret = receiptSecret(request);
  if (!secret) return error(400, "invalid_receipt", "api.invalidReceipt");
  const found = await findSubmission(env.DB, await hashReceiptSecret(secret));
  if (!found) return error(404, "not_found", "api.notFound");
  return json(200, { ok: true, submission: found.summary });
}

/** Idempotent: withdrawing again reports the earlier withdrawal and changes nothing. */
async function withdraw(request: Request, env: ApiEnv): Promise<Response> {
  const secret = receiptSecret(request);
  if (!secret) return error(400, "invalid_receipt", "api.invalidReceipt");
  const result = await withdrawSubmission(env.DB, await hashReceiptSecret(secret), Math.floor(Date.now() / 1000));
  if (result.kind === "not_found") return error(404, "not_found", "api.notFound");
  return json(200, { ok: true, alreadyWithdrawn: result.kind === "already_withdrawn", submission: result.summary });
}

async function stats(request: Request, env: ApiEnv): Promise<Response> {
  const parsed = parseStatsQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return json(400, { ok: false, issues: parsed.issues });
  return json(200, { ok: true, statistics: await statistics(env.DB, parsed.filter) });
}

const ROUTES: Record<string, Partial<Record<string, (request: Request, env: ApiEnv) => Promise<Response>>>> = {
  "/api/health": { GET: async () => json(200, { ok: true }) },
  "/api/preview": { POST: preview },
  "/api/submissions": { POST: submit },
  "/api/submission": { GET: status },
  "/api/submission/withdraw": { POST: withdraw },
  "/api/statistics": { GET: stats },
};

export async function handleApi(request: Request, env: ApiEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  const route = ROUTES[pathname];
  if (!route) return error(404, "not_found", "api.noEndpoint");
  const handler = route[request.method];
  if (!handler) return error(405, "method_not_allowed", "api.methodNotAllowed", { methods: Object.keys(route).join(", ") });
  return handler(request, env);
}
