import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashAgentKey, newAgentKey } from "../../src/domain/agentKey.ts";
import { sha256Hex } from "../../src/domain/hash.ts";
import { newReceiptSecret } from "../../src/domain/receipt.ts";
import { createAccount, MAX_UPLOADS_PER_ACCOUNT, pruneExpired, type AccountView } from "../../src/worker/accounts.ts";
import { keyUploads } from "../../src/worker/agentKeys.ts";
import { handleApi, type ApiEnv } from "../../src/worker/api.ts";
import type { Db } from "../../src/worker/db.ts";
import { handleMcp } from "../../src/worker/mcp.ts";
import { SoftAuthenticator } from "../helpers/authenticator.ts";
import { localD1 } from "../helpers/d1.ts";
import { datasetRecords } from "../helpers/dataset.ts";
import { csv } from "../helpers/export.ts";

const ORIGIN = "https://stats.test";

let env: ApiEnv;
let db: Db;
let wipe: () => Promise<void>;
let dispose: () => Promise<void>;

/** The test reset keeps accounts, as the production wipe does; these tests start without any. */
async function reset() {
  await wipe();
  await db.batch(
    ["agent_keys", "sessions", "passkey_challenges", "passkeys", "accounts"].map((table) => db.prepare(`DELETE FROM ${table}`)),
  );
}

beforeAll(async () => {
  const d1 = await localD1();
  db = d1.db;
  env = { DB: db, SUBMISSIONS_OPEN: "true" };
  wipe = d1.reset;
  dispose = d1.dispose;
});
beforeEach(() => reset());
afterAll(() => dispose());

const call = (path: string, init: RequestInit = {}) => handleApi(new Request(`${ORIGIN}${path}`, init), env);

/** One browser: its cookie jar and its passkey provider. Every request carries the site's Origin, as the page's would. */
class Browser {
  cookie: string | null = null;
  lastSetCookie: string | null = null;
  readonly authenticator: SoftAuthenticator;
  constructor(authenticator = new SoftAuthenticator(ORIGIN)) {
    this.authenticator = authenticator;
  }

  async post(path: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<Response> {
    const response = await call(path, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: JSON.stringify(body),
    });
    this.keep(response);
    return response;
  }

  async account(): Promise<AccountView | null> {
    const response = await call("/api/account", { headers: this.cookie ? { cookie: this.cookie } : {} });
    expect(response.status).toBe(200);
    return ((await response.json()) as { account: AccountView | null }).account;
  }

  private keep(response: Response) {
    const set = response.headers.get("set-cookie");
    if (!set) return;
    this.lastSetCookie = set;
    const pair = set.split(";")[0];
    this.cookie = pair.endsWith("=") ? null : pair;
  }

  async registrationOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const response = await this.post("/api/account/register/options");
    expect(response.status).toBe(200);
    return ((await response.json()) as { options: PublicKeyCredentialCreationOptionsJSON }).options;
  }

  async register(): Promise<Response> {
    return this.post("/api/account/register", { response: await this.authenticator.create(await this.registrationOptions()) });
  }

  async signInOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const response = await this.post("/api/account/login/options");
    expect(response.status).toBe(200);
    return ((await response.json()) as { options: PublicKeyCredentialRequestOptionsJSON }).options;
  }

  async signIn(): Promise<Response> {
    return this.post("/api/account/login", { response: await this.authenticator.get(await this.signInOptions()) });
  }
}

async function registered(): Promise<Browser> {
  const browser = new Browser();
  expect((await browser.register()).status).toBe(201);
  return browser;
}

/** Submits records h1–h6 (`first`) or the rest (`second`) anonymously; returns the receipt. */
async function submit(part: "first" | "second"): Promise<string> {
  const records = datasetRecords();
  const secret = newReceiptSecret();
  const response = await call("/api/submissions", {
    method: "POST",
    body: csv((part === "first" ? records.slice(0, 6) : records.slice(6)).flat()),
    headers: { authorization: `Receipt ${secret}` },
  });
  expect(response.status).toBe(201);
  return secret;
}

const claim = (browser: Browser, receipt: string) => browser.post("/api/account/submissions", {}, { authorization: `Receipt ${receipt}` });
const status = (receipt: string) => call("/api/submission", { headers: { authorization: `Receipt ${receipt}` } });
const issueCode = async (response: Response) => ((await response.json()) as { issues: { code: string }[] }).issues[0].code;

describe("signed out", () => {
  it("is the default: no account, no cookie", async () => {
    const response = await call("/api/account");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, account: null });
  });

  it("leaves anonymous submission, lookup and withdrawal as they were", async () => {
    const receipt = await submit("first");
    expect((await status(receipt)).status).toBe(200);
    const withdrawn = await call("/api/submission/withdraw", { method: "POST", headers: { authorization: `Receipt ${receipt}` } });
    expect(withdrawn.status).toBe(200);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM accounts").first()).toEqual({ n: 0 });
  });
});

describe("creating an account", () => {
  it("asks for a discoverable, user-verified passkey, with no attestation and no name", async () => {
    const options = await new Browser().registrationOptions();
    expect(options.rp).toEqual({ id: "stats.test", name: "Glyph Drop Stats" });
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", requireResidentKey: true, userVerification: "required" });
    expect(options.user.name).toMatch(/^glyph-drop-stats-\d{4}-\d{2}-\d{2}$/);
    expect(isoLength(options.user.id)).toBe(32);
    expect(options.excludeCredentials).toEqual([]);
  });

  it("signs the player in with a strict, host-only session cookie whose token is stored only as a hash", async () => {
    const browser = new Browser();
    const response = await browser.register();
    expect(response.status).toBe(201);
    const cookie = browser.lastSetCookie ?? "";
    expect(cookie).toMatch(/^__Host-gds_session=[A-Za-z0-9_-]{43}; /);
    for (const attribute of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict", "Max-Age=1209600"]) expect(cookie).toContain(attribute);
    expect(cookie).not.toContain("Domain");

    const token = (browser.cookie ?? "").split("=")[1];
    const sessions = await db.prepare("SELECT token_hash FROM sessions").all<{ token_hash: string }>();
    expect(sessions.results).toEqual([{ token_hash: await sha256Hex(token) }]);

    const account = await browser.account();
    expect(account).toMatchObject({ submissions: [], agentKeys: [] });
    expect(account?.passkeys).toHaveLength(1);
    expect(account?.passkeys[0]).toMatchObject({ backedUp: true, lastUsedAt: null });
  });

  it("refuses a passkey that didn't verify its user", async () => {
    const browser = new Browser();
    browser.authenticator.verifiesUser = false;
    const response = await browser.register();
    expect(response.status).toBe(400);
    expect(await issueCode(response)).toBe("passkey_failed");
    expect(browser.cookie).toBeNull();
    expect(await db.prepare("SELECT COUNT(*) AS n FROM accounts").first()).toEqual({ n: 0 });
  });

  it("refuses a passkey made for another site", async () => {
    const browser = new Browser(new SoftAuthenticator("https://evil.test"));
    const response = await browser.register();
    expect(response.status).toBe(400);
    expect(await issueCode(response)).toBe("passkey_failed");
  });

  it("uses each challenge once, only for what it was issued for, and only while fresh", async () => {
    const browser = new Browser();
    const created = await browser.authenticator.create(await browser.registrationOptions());
    expect((await browser.post("/api/account/register", { response: created })).status).toBe(201);
    const replay = await new Browser().post("/api/account/register", { response: created });
    expect(replay.status).toBe(400);
    expect(await issueCode(replay)).toBe("challenge_expired");

    // A sign-in challenge can't create an account.
    const other = new Browser();
    const signIn = await other.signInOptions();
    const options = { ...(await other.registrationOptions()), challenge: signIn.challenge };
    const wrongPurpose = await other.post("/api/account/register", { response: await other.authenticator.create(options) });
    expect(await issueCode(wrongPurpose)).toBe("challenge_expired");

    const late = new Browser();
    const lateOptions = await late.registrationOptions();
    await db.prepare("UPDATE passkey_challenges SET expires_at = 0 WHERE challenge = ?1").bind(lateOptions.challenge).run();
    const expired = await late.post("/api/account/register", { response: await late.authenticator.create(lateOptions) });
    expect(await issueCode(expired)).toBe("challenge_expired");
  });

  it("registers a passkey to one account only", async () => {
    await registered();
    const stored = (await db.prepare("SELECT credential_id, public_key FROM passkeys").first()) as { credential_id: string; public_key: string };
    const passkey = { credentialId: stored.credential_id, publicKey: stored.public_key, counter: 0, transports: [], backedUp: false };
    expect(await createAccount(db, isoId(crypto.getRandomValues(new Uint8Array(32))), passkey, 0)).toBeNull();
    expect(await db.prepare("SELECT COUNT(*) AS n FROM accounts").first()).toEqual({ n: 1 });
  });
});

describe("requests from other sites", () => {
  it("are refused without the site's Origin or a JSON body", async () => {
    const browser = await registered();
    const headers = { cookie: browser.cookie ?? "", "content-type": "application/json" };
    const noOrigin = await call("/api/account/delete", { method: "POST", headers, body: "{}" });
    expect(noOrigin.status).toBe(403);
    expect(await issueCode(noOrigin)).toBe("bad_origin");
    const otherOrigin = await call("/api/account/delete", { method: "POST", headers: { ...headers, origin: "https://evil.test" }, body: "{}" });
    expect(otherOrigin.status).toBe(403);
    const form = await call("/api/account/delete", { method: "POST", headers: { cookie: browser.cookie ?? "", origin: ORIGIN, "content-type": "text/plain" }, body: "{}" });
    expect(form.status).toBe(415);
    const notJson = await browser.post("/api/account/agent-keys/revoke", undefined);
    expect(notJson.status).toBe(400);
    expect(await browser.account()).not.toBeNull();
  });

  it("are refused when the site's origin is pinned and the request names another", async () => {
    const pinned = { ...env, SITE_ORIGIN: "https://stats.ingress.wiki" };
    const response = await handleApi(new Request(`${ORIGIN}/api/account/login/options`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" }), pinned);
    expect(response.status).toBe(403);
  });
});

describe("signing in", () => {
  it("works from another browser with the same passkey, and records its use", async () => {
    const first = await registered();
    const second = new Browser(first.authenticator);
    const response = await second.signIn();
    expect(response.status).toBe(200);
    expect(second.cookie).not.toBeNull();
    expect(second.cookie).not.toBe(first.cookie);
    const account = await second.account();
    expect(account?.passkeys[0].lastUsedAt).not.toBeNull();
    expect(await db.prepare("SELECT counter FROM passkeys").first()).toEqual({ counter: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM sessions").first()).toEqual({ n: 2 });
  });

  it("offers any of the site's passkeys and needs user verification", async () => {
    const options = await new Browser().signInOptions();
    expect(options.rpId).toBe("stats.test");
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials ?? []).toEqual([]);
  });

  it("refuses a replayed response, an unknown passkey, an unverified user and a mismatched user handle", async () => {
    const browser = await registered();
    const options = await browser.signInOptions();
    const signed = await browser.authenticator.get(options);
    expect((await browser.post("/api/account/login", { response: signed })).status).toBe(200);
    expect(await issueCode(await browser.post("/api/account/login", { response: signed }))).toBe("challenge_expired");

    const stranger = new Browser();
    await stranger.authenticator.create(await stranger.registrationOptions());
    const unknown = await stranger.signIn();
    expect(unknown.status).toBe(401);
    expect(await issueCode(unknown)).toBe("unknown_passkey");

    browser.authenticator.verifiesUser = false;
    expect(await issueCode(await browser.signIn())).toBe("passkey_failed");
    browser.authenticator.verifiesUser = true;

    const forged = await browser.authenticator.get(await browser.signInOptions());
    forged.response.userHandle = isoId(new Uint8Array(32));
    expect(await issueCode(await browser.post("/api/account/login", { response: forged }))).toBe("passkey_failed");
  });

  it("refuses a counter that went backwards, a sign of a cloned passkey", async () => {
    const browser = await registered();
    await db.prepare("UPDATE passkeys SET counter = 50").run();
    expect(await issueCode(await browser.signIn())).toBe("passkey_failed");
  });
});

describe("sessions", () => {
  it("end on sign-out, which clears the cookie and is safe to repeat", async () => {
    const browser = await registered();
    const cookie = browser.cookie;
    const response = await browser.post("/api/account/logout");
    expect(response.status).toBe(200);
    expect(browser.lastSetCookie).toMatch(/^__Host-gds_session=; Max-Age=0/);
    expect(browser.cookie).toBeNull();
    browser.cookie = cookie;
    expect(await browser.account()).toBeNull();
    expect((await browser.post("/api/account/logout")).status).toBe(200);
  });

  it("are replaced when the browser signs in again", async () => {
    const browser = await registered();
    const before = browser.cookie;
    expect((await browser.signIn()).status).toBe(200);
    expect(browser.cookie).not.toBe(before);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM sessions").first()).toEqual({ n: 1 });
  });

  it("expire, after which the account's requests say so and clear the cookie", async () => {
    const browser = await registered();
    await db.prepare("UPDATE sessions SET expires_at = 0").run();
    expect(await browser.account()).toBeNull();
    const response = await browser.post("/api/account/delete");
    expect(response.status).toBe(401);
    expect(await issueCode(response)).toBe("signed_out");
    expect(browser.cookie).toBeNull();
  });

  it("ignore a malformed or made-up cookie", async () => {
    const browser = new Browser();
    browser.cookie = "__Host-gds_session=not-a-token";
    expect(await browser.account()).toBeNull();
    browser.cookie = `__Host-gds_session=${"A".repeat(43)}`;
    expect(await browser.account()).toBeNull();
  });

  it("and challenges are pruned once expired", async () => {
    await registered();
    await new Browser().signInOptions();
    await pruneExpired(db, 4_000_000_000);
    expect(await db.prepare("SELECT (SELECT COUNT(*) FROM sessions) + (SELECT COUNT(*) FROM passkey_challenges) AS n").first()).toEqual({ n: 0 });
  });
});

describe("submissions in an account", () => {
  it("are added with their receipt, once, and only to one account", async () => {
    const browser = await registered();
    const receipt = await submit("first");
    const response = await claim(browser, receipt);
    expect(response.status).toBe(200);
    const account = ((await response.json()) as { account: AccountView }).account;
    expect(account.submissions).toHaveLength(1);
    expect(account.submissions[0]).toMatchObject({ status: "completed", rowCount: expect.any(Number) });
    expect((await claim(browser, receipt)).status).toBe(200);
    expect((await browser.account())?.submissions).toHaveLength(1);

    const other = await registered();
    const elsewhere = await claim(other, receipt);
    expect(elsewhere.status).toBe(409);
    expect(await issueCode(elsewhere)).toBe("claimed_elsewhere");
  });

  it("need a session, a valid receipt and an active submission", async () => {
    const receipt = await submit("first");
    const signedOut = new Browser();
    expect((await claim(signedOut, receipt)).status).toBe(401);

    const browser = await registered();
    expect(await issueCode(await claim(browser, "gds1_nope"))).toBe("invalid_receipt");
    expect((await claim(browser, newReceiptSecret())).status).toBe(404);
    await call("/api/submission/withdraw", { method: "POST", headers: { authorization: `Receipt ${receipt}` } });
    expect(await issueCode(await claim(browser, receipt))).toBe("submission_withdrawn");
  });

  it("can be withdrawn from the account, idempotently, and the receipt agrees", async () => {
    const browser = await registered();
    const receipt = await submit("first");
    const id = (((await (await claim(browser, receipt)).json()) as { account: AccountView }).account.submissions[0]).id;
    const response = await browser.post("/api/account/submissions/withdraw", { submissionId: id });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, alreadyWithdrawn: false });
    expect(await (await status(receipt)).json()).toMatchObject({ submission: { status: "withdrawn" } });
    expect(await (await browser.post("/api/account/submissions/withdraw", { submissionId: id })).json()).toMatchObject({ alreadyWithdrawn: true });
  });

  it("can't be withdrawn by another account", async () => {
    const owner = await registered();
    const receipt = await submit("first");
    const id = (((await (await claim(owner, receipt)).json()) as { account: AccountView }).account.submissions[0]).id;
    const other = await registered();
    const response = await other.post("/api/account/submissions/withdraw", { submissionId: id });
    expect(response.status).toBe(404);
    expect(await issueCode(response)).toBe("not_in_account");
    expect(await (await status(receipt)).json()).toMatchObject({ submission: { status: "completed" } });
    expect((await other.post("/api/account/submissions/withdraw", { submissionId: "1" })).status).toBe(400);
  });

  it("keep working with their receipt and anonymous agent keys", async () => {
    const browser = await registered();
    const receipt = await submit("first");
    await claim(browser, receipt);
    expect((await status(receipt)).status).toBe(200);
    const key = newAgentKey();
    const linked = await call("/api/agent-keys", { method: "POST", headers: { authorization: `Receipt ${receipt}` }, body: JSON.stringify({ keyHash: await hashAgentKey(key) }) });
    expect(linked.status).toBe(200);
    expect(await keyUploads(db, await hashAgentKey(key))).toHaveLength(1);
  });

  it(`are limited to ${MAX_UPLOADS_PER_ACCOUNT} per account`, async () => {
    const browser = await registered();
    const accountId = ((await db.prepare("SELECT id FROM accounts").first()) as { id: number }).id;
    await db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
         INSERT INTO uploads (id, secret_hash, file_hash, status, created_at, format_version, row_count, rejected_count)
         SELECT 1000000 + i, printf('%064d', i), printf('%064d', i), 'completed', 0, 1, 0, 0 FROM n`,
      )
      .bind(MAX_UPLOADS_PER_ACCOUNT)
      .run();
    await db.prepare("INSERT INTO account_uploads (upload_id, account_id, linked_at) SELECT id, ?1, 0 FROM uploads WHERE id > 1000000").bind(accountId).run();
    const response = await claim(browser, await submit("first"));
    expect(response.status).toBe(409);
    expect(await issueCode(response)).toBe("account_full");
  });
});

describe("an account's agent keys", () => {
  async function makeKey(browser: Browser): Promise<{ key: string; response: Response }> {
    const key = newAgentKey();
    return { key, response: await browser.post("/api/account/agent-keys", { keyHash: await hashAgentKey(key) }) };
  }

  it("read every submission in the account, including ones added later", async () => {
    const browser = await registered();
    await claim(browser, await submit("first"));
    const { key, response } = await makeKey(browser);
    expect(response.status).toBe(201);
    expect((await browser.account())?.agentKeys).toHaveLength(1);
    expect(await keyUploads(db, await hashAgentKey(key))).toHaveLength(1);
    await claim(browser, await submit("second"));
    expect(await keyUploads(db, await hashAgentKey(key))).toHaveLength(2);

    const mcp = await handleMcp(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_my_submissions", arguments: { key } } }),
      }),
      { DB: db },
    );
    const result = (await mcp.json()) as { result: { isError?: boolean; structuredContent?: { submissions: unknown[] }; content: { text: string }[] } };
    expect(result.result.isError).toBeFalsy();
    expect(JSON.parse(result.result.content[0].text).submissions).toHaveLength(2);
  });

  it("are refused a hash already in use, and can't be extended with a receipt", async () => {
    const browser = await registered();
    const { key } = await makeKey(browser);
    const again = await browser.post("/api/account/agent-keys", { keyHash: await hashAgentKey(key) });
    expect(await issueCode(again)).toBe("key_in_use");
    expect(await issueCode(await browser.post("/api/account/agent-keys", { keyHash: "x" }))).toBe("invalid_key_hash");

    const receipt = await submit("first");
    const linked = await call("/api/agent-keys", { method: "POST", headers: { authorization: `Receipt ${receipt}` }, body: JSON.stringify({ keyHash: await hashAgentKey(key) }) });
    expect(linked.status).toBe(409);
    expect(await issueCode(linked)).toBe("account_key");
  });

  it("are revoked by their account only, or by anyone holding the key", async () => {
    const owner = await registered();
    const { key } = await makeKey(owner);
    const keyId = (await owner.account())?.agentKeys[0].id;
    const other = await registered();
    expect(await (await other.post("/api/account/agent-keys/revoke", { keyId })).json()).toMatchObject({ revoked: false });
    expect(await keyUploads(db, await hashAgentKey(key))).not.toBeNull();
    expect(await (await owner.post("/api/account/agent-keys/revoke", { keyId })).json()).toMatchObject({ revoked: true });
    expect(await keyUploads(db, await hashAgentKey(key))).toBeNull();

    const { key: second } = await makeKey(owner);
    const revoked = await call("/api/agent-key/revoke", { method: "POST", headers: { authorization: `Agent ${second}` } });
    expect(await revoked.json()).toMatchObject({ revoked: true });
  });
});

describe("passkeys", () => {
  async function addPasskey(browser: Browser, authenticator: SoftAuthenticator): Promise<Response> {
    const optionsResponse = await browser.post("/api/account/passkeys/options");
    const { options } = (await optionsResponse.json()) as { options: PublicKeyCredentialCreationOptionsJSON };
    return browser.post("/api/account/passkeys", { response: await authenticator.create(options) });
  }

  it("can be added, on another device, and used to sign in", async () => {
    const browser = await registered();
    const phone = new SoftAuthenticator(ORIGIN);
    const response = await addPasskey(browser, phone);
    expect(response.status).toBe(201);
    expect((await browser.account())?.passkeys).toHaveLength(2);
    const onPhone = new Browser(phone);
    expect((await onPhone.signIn()).status).toBe(200);
    expect((await onPhone.account())?.passkeys).toHaveLength(2);
  });

  it("aren't added twice from the same authenticator", async () => {
    const browser = await registered();
    const optionsResponse = await browser.post("/api/account/passkeys/options");
    const { options } = (await optionsResponse.json()) as { options: PublicKeyCredentialCreationOptionsJSON };
    expect(options.excludeCredentials).toHaveLength(1);
    await expect(browser.authenticator.create(options)).rejects.toThrow("InvalidStateError");
  });

  it("aren't added to an account with another account's challenge", async () => {
    const first = await registered();
    const second = await registered();
    const optionsResponse = await first.post("/api/account/passkeys/options");
    const { options } = (await optionsResponse.json()) as { options: PublicKeyCredentialCreationOptionsJSON };
    const response = await second.post("/api/account/passkeys", { response: await new SoftAuthenticator(ORIGIN).create(options) });
    expect(response.status).toBe(400);
    expect((await second.account())?.passkeys).toHaveLength(1);
  });

  it("can be removed, except the last", async () => {
    const browser = await registered();
    await addPasskey(browser, new SoftAuthenticator(ORIGIN));
    const original = isoId(browser.authenticator.credentials[0].id);
    const added = (await browser.account())?.passkeys.find((passkey) => passkey.id !== original)?.id;
    expect((await browser.post("/api/account/passkeys/remove", { passkeyId: original })).status).toBe(200);
    const last = await browser.post("/api/account/passkeys/remove", { passkeyId: added });
    expect(last.status).toBe(409);
    expect(await issueCode(last)).toBe("last_passkey");
    expect((await browser.post("/api/account/passkeys/remove", { passkeyId: original })).status).toBe(404);
    expect(await issueCode(await browser.signIn())).toBe("unknown_passkey");
  });
});

describe("deleting an account", () => {
  it("removes the account, its sessions, passkeys and keys, but not its submissions", async () => {
    const browser = await registered();
    const receipt = await submit("first");
    await claim(browser, receipt);
    const key = newAgentKey();
    await browser.post("/api/account/agent-keys", { keyHash: await hashAgentKey(key) });

    const response = await browser.post("/api/account/delete");
    expect(response.status).toBe(200);
    expect(browser.cookie).toBeNull();
    for (const table of ["accounts", "passkeys", "sessions", "account_uploads", "agent_keys", "passkey_challenges"]) {
      expect(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first(), table).toEqual({ n: 0 });
    }
    expect(await (await status(receipt)).json()).toMatchObject({ submission: { status: "completed" } });
    expect(await keyUploads(db, await hashAgentKey(key))).toBeNull();
    expect(await issueCode(await browser.signIn())).toBe("unknown_passkey");

    // The submission is free to be added to a new account.
    const fresh = await registered();
    expect((await claim(fresh, receipt)).status).toBe(200);
  });
});

describe("the end of the test period", () => {
  it("empties accounts of their submissions and keys, but keeps them", async () => {
    const browser = await registered();
    await claim(browser, await submit("first"));
    await browser.post("/api/account/agent-keys", { keyHash: await hashAgentKey(newAgentKey()) });
    await wipe();
    const account = await browser.account();
    expect(account).toMatchObject({ submissions: [], agentKeys: [] });
    expect((await new Browser(browser.authenticator).signIn()).status).toBe(200);
  });
});

function isoLength(base64url: string): number {
  return atob(base64url.replaceAll("-", "+").replaceAll("_", "/")).length;
}

function isoId(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
