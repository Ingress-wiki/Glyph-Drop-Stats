import { hashAgentKey, isAgentKey, isAgentKeyHash } from "../domain/agentKey.ts";
import { DEFAULT_LIMITS, parseExport } from "../domain/importer.ts";
import { previewOf } from "../domain/preview.ts";
import { hashReceiptSecret, isReceiptSecret } from "../domain/receipt.ts";
import { parseStatsQuery } from "../domain/statsQuery.ts";
import { emptyOutcomeCounts } from "../domain/versions.ts";
import { handleAccountApi, isAccountPath } from "./accountApi.ts";
import { linkAgentKey, MAX_UPLOADS_PER_KEY, revokeAgentKey } from "./agentKeys.ts";
import type { Db } from "./db.ts";
import { error, json, readBodyLimited } from "./http.ts";
import { statistics } from "./statistics.ts";
import { classify, confirmSubmission, countOutcomes, findSubmission, withdrawSubmission } from "./submissions.ts";

export interface ApiEnv {
  DB: Db;
  /**
   * "true" to accept submissions. "test" accepts them for a test period: the
   * page warns that everything submitted will be deleted before the site
   * opens to the public. Anything else keeps them closed (checking a file,
   * statistics, lookups and withdrawal still work): a deployment opens them
   * deliberately, once retention and the data terms are in place.
   */
  SUBMISSIONS_OPEN?: string;
  /** The site's one origin in production; passkeys are bound to it (src/worker/passkeys.ts). */
  SITE_ORIGIN?: string;
}

const testPeriod = (env: ApiEnv) => env.SUBMISSIONS_OPEN === "test";
const submissionsOpen = (env: ApiEnv) => env.SUBMISSIONS_OPEN === "true" || testPeriod(env);

const tooLarge = () => error(413, "file_too_large", "file.tooLarge", { limit: DEFAULT_LIMITS.maxBytes });

/**
 * The receipt travels in `Authorization: Receipt <secret>`, never in a URL,
 * so it doesn't end up in logs, history or referrers.
 */
function receiptSecret(request: Request): string | null {
  const match = /^Receipt (\S+)$/.exec(request.headers.get("authorization") ?? "");
  return match && isReceiptSecret(match[1]) ? match[1] : null;
}

/** The agent key travels in `Authorization: Agent <key>`, never in a URL, like a receipt. */
function agentKey(request: Request): string | null {
  const match = /^Agent (\S+)$/.exec(request.headers.get("authorization") ?? "");
  return match && isAgentKey(match[1]) ? match[1] : null;
}

/** `{"keyHash": "<64 hex>"}` is all a link request carries. */
const MAX_KEY_BODY = 1024;

function keyHashOf(body: Uint8Array): string | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    return typeof value === "object" && value !== null && "keyHash" in value && typeof value.keyHash === "string" && isAgentKeyHash(value.keyHash) ? value.keyHash : null;
  } catch {
    return null;
  }
}

/**
 * Links the receipt's submission to a read-only agent key. The key is made
 * in the player's browser and only its hash is sent, so the server never
 * holds a usable key. Repeating it changes nothing.
 */
async function linkKey(request: Request, env: ApiEnv): Promise<Response> {
  const secret = receiptSecret(request);
  if (!secret) return error(400, "invalid_receipt", "api.invalidReceipt");
  const body = await readBodyLimited(request, MAX_KEY_BODY);
  const keyHash = body && keyHashOf(body);
  if (!keyHash) return error(400, "invalid_key_hash", "api.invalidKeyHash");
  const result = await linkAgentKey(env.DB, await hashReceiptSecret(secret), keyHash, Math.floor(Date.now() / 1000));
  switch (result.kind) {
    case "linked":
      return json(200, { ok: true, submissions: result.submissions });
    case "not_found":
      return error(404, "not_found", "api.notFound");
    case "withdrawn":
      return error(409, "submission_withdrawn", "api.submissionWithdrawn");
    case "full":
      return error(409, "key_full", "api.keyFull", { limit: MAX_UPLOADS_PER_KEY });
    case "account_key":
      return error(409, "account_key", "api.accountKey");
  }
}

/** Anyone holding the key may revoke it. Idempotent: `revoked` is false when no key matched. */
async function revokeKey(request: Request, env: ApiEnv): Promise<Response> {
  const key = agentKey(request);
  if (!key) return error(400, "invalid_agent_key", "api.invalidAgentKey");
  return json(200, { ok: true, revoked: await revokeAgentKey(env.DB, await hashAgentKey(key)) });
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
  if (!submissionsOpen(env)) return error(403, "submissions_closed", "api.submissionsClosed");
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

/** What this deployment allows, so the page can say so before anyone makes a receipt. */
async function config(...[, env]: [Request, ApiEnv]): Promise<Response> {
  return json(200, { ok: true, submissionsOpen: submissionsOpen(env), testPeriod: testPeriod(env) });
}

const ROUTES: Record<string, Partial<Record<string, (request: Request, env: ApiEnv) => Promise<Response>>>> = {
  "/api/health": { GET: async () => json(200, { ok: true }) },
  "/api/config": { GET: config },
  "/api/preview": { POST: preview },
  "/api/submissions": { POST: submit },
  "/api/submission": { GET: status },
  "/api/submission/withdraw": { POST: withdraw },
  "/api/statistics": { GET: stats },
  "/api/agent-keys": { POST: linkKey },
  "/api/agent-key/revoke": { POST: revokeKey },
};

export async function handleApi(request: Request, env: ApiEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (isAccountPath(pathname)) return handleAccountApi(request, env);
  const route = ROUTES[pathname];
  if (!route) return error(404, "not_found", "api.noEndpoint");
  const handler = route[request.method];
  if (!handler) return error(405, "method_not_allowed", "api.methodNotAllowed", { methods: Object.keys(route).join(", ") });
  return handler(request, env);
}
