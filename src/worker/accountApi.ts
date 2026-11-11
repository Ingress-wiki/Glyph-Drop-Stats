import { isAgentKeyHash } from "../domain/agentKey.ts";
import { base64url, sha256Hex } from "../domain/hash.ts";
import { hashReceiptSecret, isReceiptSecret } from "../domain/receipt.ts";
import {
  accountView,
  addPasskey,
  claimUpload,
  createAccount,
  createAccountKey,
  createSession,
  deleteAccount,
  endSession,
  MAX_PASSKEYS,
  MAX_UPLOADS_PER_ACCOUNT,
  removePasskey,
  revokeAccountKey,
  SESSION_SECONDS,
  sessionAccount,
  withdrawAccountUpload,
} from "./accounts.ts";
import type { Db } from "./db.ts";
import { error, json, readBodyLimited } from "./http.ts";
import {
  addPasskeyOptions,
  isAuthenticationJSON,
  isRegistrationJSON,
  registrationOptions,
  relyingParty,
  signInOptions,
  verifyRegistration,
  verifySignIn,
  type CeremonyFailure,
  type RelyingParty,
} from "./passkeys.ts";

/**
 * The optional account's endpoints, under /api/account. Nothing else on the
 * site needs an account, and nothing here changes how a receipt or an
 * anonymous agent key works.
 *
 * - The session is a random token in a `__Host-` cookie (HttpOnly, Secure,
 *   SameSite=Strict); only its SHA-256 is stored.
 * - Every POST must come from the site's own page: its Origin must be the
 *   site's and its body JSON. With SameSite=Strict, that keeps other sites
 *   from acting with a player's session.
 */

export interface AccountEnv {
  DB: Db;
  /** The site's one origin in production, such as https://stats.ingress.wiki. */
  SITE_ORIGIN?: string;
}

const COOKIE = "__Host-gds_session";
/** Bigger than any passkey response or request this API takes. */
const MAX_BODY = 16 * 1024;

const nowSeconds = () => Math.floor(Date.now() / 1000);

function sessionToken(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) {
      const token = value.join("=");
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
    }
  }
  return null;
}

const sessionCookie = (token: string) => `${COOKIE}=${token}; Max-Age=${SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Strict`;
const clearedCookie = () => `${COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict`;

function withCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, headers });
}

async function signedInAccount(request: Request, db: Db): Promise<number | null> {
  const token = sessionToken(request);
  return token ? sessionAccount(db, await sha256Hex(token), nowSeconds()) : null;
}

/** A new token on every sign-in; the browser's previous session, if any, ends. */
async function startSession(request: Request, db: Db, accountId: number, response: Response): Promise<Response> {
  const previous = sessionToken(request);
  if (previous) await endSession(db, await sha256Hex(previous));
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  await createSession(db, accountId, await sha256Hex(token), nowSeconds());
  return withCookie(response, sessionCookie(token));
}

const signedOut = () => withCookie(error(401, "signed_out", "api.signedOut"), clearedCookie());

function ceremonyError(failure: CeremonyFailure): Response {
  switch (failure) {
    case "expired":
      return error(400, "challenge_expired", "api.challengeExpired");
    case "unknown_passkey":
      return error(401, "unknown_passkey", "api.unknownPasskey");
    case "failed":
      return error(400, "passkey_failed", "api.passkeyFailed");
  }
}

type Body = Record<string, unknown>;

/** The JSON body of a request from the site's own page, or the response refusing it. */
async function pageBody(request: Request, rp: RelyingParty): Promise<{ ok: true; body: Body } | { ok: false; response: Response }> {
  if (request.headers.get("origin") !== rp.origin) return { ok: false, response: error(403, "bad_origin", "api.badOrigin") };
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) return { ok: false, response: error(415, "invalid_body", "api.invalidBody") };
  const bytes = await readBodyLimited(request, MAX_BODY);
  if (bytes === null) return { ok: false, response: error(413, "invalid_body", "api.invalidBody") };
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof body === "object" && body !== null && !Array.isArray(body)) return { ok: true, body: body as Body };
  } catch {
    // Falls through to the refusal below.
  }
  return { ok: false, response: error(400, "invalid_body", "api.invalidBody") };
}

interface Context {
  request: Request;
  db: Db;
  rp: RelyingParty;
}

type Handler = (context: Context) => Promise<Response>;

/** A POST from the page, signed in or not. */
const fromPage =
  (handler: (context: Context & { body: Body }) => Promise<Response>): Handler =>
  async (context) => {
    const page = await pageBody(context.request, context.rp);
    return page.ok ? handler({ ...context, body: page.body }) : page.response;
  };

/** A POST from the page by a signed-in player. */
const signedIn = (handler: (context: Context & { body: Body; account: number }) => Promise<Response>): Handler =>
  fromPage(async (context) => {
    const account = await signedInAccount(context.request, context.db);
    return account === null ? signedOut() : handler({ ...context, account });
  });

const isPositiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const ROUTES: Record<string, Partial<Record<string, Handler>>> = {
  /** Who is signed in, if anyone. Signed out is an answer, not an error. */
  "/api/account": {
    GET: async ({ request, db }) => {
      const account = await signedInAccount(request, db);
      const view = account === null ? null : await accountView(db, account);
      return json(200, { ok: true, account: view });
    },
  },

  "/api/account/register/options": { POST: fromPage(async ({ db, rp }) => json(200, { ok: true, options: await registrationOptions(db, rp, nowSeconds()) })) },
  "/api/account/register": {
    POST: fromPage(async ({ request, db, rp, body }) => {
      if (!isRegistrationJSON(body.response)) return error(400, "invalid_body", "api.invalidBody");
      const verified = await verifyRegistration(db, rp, body.response, "register", nowSeconds());
      if (!verified.ok) return ceremonyError(verified.failure);
      if (!verified.userHandle) return ceremonyError("failed");
      const account = await createAccount(db, verified.userHandle, verified.passkey, nowSeconds());
      if (account === null) return error(409, "passkey_exists", "api.passkeyExists");
      return startSession(request, db, account, json(201, { ok: true, account: await accountView(db, account) }));
    }),
  },

  "/api/account/login/options": { POST: fromPage(async ({ db, rp }) => json(200, { ok: true, options: await signInOptions(db, rp, nowSeconds()) })) },
  "/api/account/login": {
    POST: fromPage(async ({ request, db, rp, body }) => {
      if (!isAuthenticationJSON(body.response)) return error(400, "invalid_body", "api.invalidBody");
      const verified = await verifySignIn(db, rp, body.response, nowSeconds());
      if (!verified.ok) return ceremonyError(verified.failure);
      return startSession(request, db, verified.accountId, json(200, { ok: true, account: await accountView(db, verified.accountId) }));
    }),
  },

  /** Signing out of a session that already ended is still signed out. */
  "/api/account/logout": {
    POST: fromPage(async ({ request, db }) => {
      const token = sessionToken(request);
      if (token) await endSession(db, await sha256Hex(token));
      return withCookie(json(200, { ok: true }), clearedCookie());
    }),
  },

  "/api/account/passkeys/options": {
    POST: signedIn(async ({ db, rp, account }) => {
      const options = await addPasskeyOptions(db, rp, account, nowSeconds());
      return options ? json(200, { ok: true, options }) : signedOut();
    }),
  },
  "/api/account/passkeys": {
    POST: signedIn(async ({ db, rp, account, body }) => {
      if (!isRegistrationJSON(body.response)) return error(400, "invalid_body", "api.invalidBody");
      const verified = await verifyRegistration(db, rp, body.response, "add_passkey", nowSeconds());
      if (!verified.ok) return ceremonyError(verified.failure);
      // The challenge was issued to this account's session, not another's.
      if (verified.accountId !== account) return ceremonyError("failed");
      switch (await addPasskey(db, account, verified.passkey, nowSeconds())) {
        case "exists":
          return error(409, "passkey_exists", "api.passkeyExists");
        case "full":
          return error(409, "passkeys_full", "api.passkeysFull", { limit: MAX_PASSKEYS });
        case "added":
          return json(201, { ok: true, account: await accountView(db, account) });
      }
    }),
  },
  "/api/account/passkeys/remove": {
    POST: signedIn(async ({ db, account, body }) => {
      if (typeof body.passkeyId !== "string") return error(400, "invalid_body", "api.invalidBody");
      switch (await removePasskey(db, account, body.passkeyId)) {
        case "not_found":
          return error(404, "not_in_account", "api.notInAccount");
        case "last":
          return error(409, "last_passkey", "api.lastPasskey");
        case "removed":
          return json(200, { ok: true, account: await accountView(db, account) });
      }
    }),
  },

  /** Adds the submission whose receipt is in `Authorization: Receipt`, which proves the player holds it. */
  "/api/account/submissions": {
    POST: signedIn(async ({ request, db, account }) => {
      const match = /^Receipt (\S+)$/.exec(request.headers.get("authorization") ?? "");
      if (!match || !isReceiptSecret(match[1])) return error(400, "invalid_receipt", "api.invalidReceipt");
      switch (await claimUpload(db, account, await hashReceiptSecret(match[1]), nowSeconds())) {
        case "not_found":
          return error(404, "not_found", "api.notFound");
        case "withdrawn":
          return error(409, "submission_withdrawn", "api.claimWithdrawn");
        case "elsewhere":
          return error(409, "claimed_elsewhere", "api.claimedElsewhere");
        case "full":
          return error(409, "account_full", "api.accountFull", { limit: MAX_UPLOADS_PER_ACCOUNT });
        case "linked":
          return json(200, { ok: true, account: await accountView(db, account) });
      }
    }),
  },
  /** Idempotent, like withdrawing with the receipt. */
  "/api/account/submissions/withdraw": {
    POST: signedIn(async ({ db, account, body }) => {
      if (!isPositiveInteger(body.submissionId)) return error(400, "invalid_body", "api.invalidBody");
      const result = await withdrawAccountUpload(db, account, body.submissionId, nowSeconds());
      if (result.kind === "not_found") return error(404, "not_in_account", "api.notInAccount");
      return json(200, { ok: true, alreadyWithdrawn: result.kind === "already_withdrawn", account: await accountView(db, account) });
    }),
  },

  /** As for an anonymous key, the key is made in the browser and only its hash is sent. */
  "/api/account/agent-keys": {
    POST: signedIn(async ({ db, account, body }) => {
      if (typeof body.keyHash !== "string" || !isAgentKeyHash(body.keyHash)) return error(400, "invalid_key_hash", "api.invalidKeyHash");
      if (!(await createAccountKey(db, account, body.keyHash, nowSeconds()))) return error(409, "key_in_use", "api.keyInUse");
      return json(201, { ok: true, account: await accountView(db, account) });
    }),
  },
  /** Idempotent: `revoked` is false when the account has no such key. */
  "/api/account/agent-keys/revoke": {
    POST: signedIn(async ({ db, account, body }) => {
      if (!isPositiveInteger(body.keyId)) return error(400, "invalid_body", "api.invalidBody");
      const revoked = await revokeAccountKey(db, account, body.keyId);
      return json(200, { ok: true, revoked, account: await accountView(db, account) });
    }),
  },

  /** Deletes the account; its submissions stay, and their receipts keep working. */
  "/api/account/delete": {
    POST: signedIn(async ({ db, account }) => {
      await deleteAccount(db, account);
      return withCookie(json(200, { ok: true }), clearedCookie());
    }),
  },
};

export function isAccountPath(pathname: string): boolean {
  return pathname in ROUTES;
}

export async function handleAccountApi(request: Request, env: AccountEnv): Promise<Response> {
  const route = ROUTES[new URL(request.url).pathname];
  if (!route) return error(404, "not_found", "api.noEndpoint");
  const handler = route[request.method];
  if (!handler) return error(405, "method_not_allowed", "api.methodNotAllowed", { methods: Object.keys(route).join(", ") });
  return handler({ request, db: env.DB, rp: relyingParty(env, request) });
}
