import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashAgentKey, isAgentKey, isAgentKeyHash, newAgentKey } from "../../src/domain/agentKey.ts";
import { hashReceiptSecret, newReceiptSecret } from "../../src/domain/receipt.ts";
import { handleApi, type ApiEnv } from "../../src/worker/api.ts";
import { keyUploads, linkAgentKey, MAX_UPLOADS_PER_KEY, ownRecordIds, revokeAgentKey } from "../../src/worker/agentKeys.ts";
import { localD1 } from "../helpers/d1.ts";
import { datasetRecords } from "../helpers/dataset.ts";
import { csv } from "../helpers/export.ts";

let env: ApiEnv;
let reset: () => Promise<void>;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const d1 = await localD1();
  env = { DB: d1.db, SUBMISSIONS_OPEN: "true" };
  reset = d1.reset;
  dispose = d1.dispose;
});
beforeEach(() => reset());
afterAll(() => dispose());

const NOW = 1_793_000_000;
const call = (path: string, init: RequestInit = {}) => handleApi(new Request(`https://stats.test${path}`, init), env);

/** Submits records h1–h6 (`first`) or the rest (`second`), as two players' exports might overlap. */
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

const withdraw = (secret: string) => call("/api/submission/withdraw", { method: "POST", headers: { authorization: `Receipt ${secret}` } });
const link = (secret: string, body: unknown) => call("/api/agent-keys", { method: "POST", headers: { authorization: `Receipt ${secret}` }, body: JSON.stringify(body) });
const revoke = (key: string) => call("/api/agent-key/revoke", { method: "POST", headers: { authorization: `Agent ${key}` } });

describe("agent keys", () => {
  it("are 256-bit secrets in their own alphabet, never mistaken for a receipt", async () => {
    const key = newAgentKey();
    expect(isAgentKey(key)).toBe(true);
    expect(isAgentKey(newReceiptSecret())).toBe(false);
    expect(newAgentKey()).not.toBe(key);
    expect(isAgentKeyHash(await hashAgentKey(key))).toBe(true);
    expect(isAgentKeyHash("A".repeat(64))).toBe(false);
  });
});

describe("linking a key to submissions", () => {
  it("creates the key on its first link, and repeating it changes nothing", async () => {
    const secret = await submit("first");
    const keyHash = await hashAgentKey(newAgentKey());
    expect(await linkAgentKey(env.DB, await hashReceiptSecret(secret), keyHash, NOW)).toEqual({ kind: "linked", submissions: 1 });
    expect(await linkAgentKey(env.DB, await hashReceiptSecret(secret), keyHash, NOW + 5)).toEqual({ kind: "linked", submissions: 1 });
    expect(await keyUploads(env.DB, keyHash)).toHaveLength(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_keys").first()).toEqual({ n: 1 });
  });

  it("lets one key cover several submissions, and reads the records they supply", async () => {
    const a = await submit("first");
    const b = await submit("second");
    const keyHash = await hashAgentKey(newAgentKey());
    await linkAgentKey(env.DB, await hashReceiptSecret(a), keyHash, NOW);
    expect(await linkAgentKey(env.DB, await hashReceiptSecret(b), keyHash, NOW)).toEqual({ kind: "linked", submissions: 2 });
    const uploads = (await keyUploads(env.DB, keyHash)) ?? [];
    expect((await ownRecordIds(env.DB, uploads.slice(0, 1))).size).toBe(6);
    expect((await ownRecordIds(env.DB, uploads)).size).toBe(10);
  });

  it("stops reading a submission once it is withdrawn, and won't link a withdrawn one", async () => {
    const a = await submit("first");
    const keyHash = await hashAgentKey(newAgentKey());
    await linkAgentKey(env.DB, await hashReceiptSecret(a), keyHash, NOW);
    expect((await withdraw(a)).status).toBe(200);
    const uploads = (await keyUploads(env.DB, keyHash)) ?? [];
    expect(uploads).toHaveLength(1);
    expect((await ownRecordIds(env.DB, uploads)).size).toBe(0);
    expect(await linkAgentKey(env.DB, await hashReceiptSecret(a), await hashAgentKey(newAgentKey()), NOW)).toEqual({ kind: "withdrawn" });
  });

  it("refuses an unknown receipt, and a key already at its limit", async () => {
    expect(await linkAgentKey(env.DB, await hashReceiptSecret(newReceiptSecret()), await hashAgentKey(newAgentKey()), NOW)).toEqual({ kind: "not_found" });

    const keyHash = await hashAgentKey(newAgentKey());
    const fillers = Array.from({ length: MAX_UPLOADS_PER_KEY }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO uploads (secret_hash, file_hash, status, created_at, format_version, row_count, rejected_count) VALUES (?1, ?1, 'completed', ?2, 1, 0, 0)",
      ).bind(String(i).padStart(64, "0"), NOW),
    );
    await env.DB.batch([
      ...fillers,
      env.DB.prepare("INSERT INTO agent_keys (key_hash, created_at) VALUES (?1, ?2)").bind(keyHash, NOW),
      env.DB.prepare("INSERT INTO agent_key_uploads (key_id, upload_id, linked_at) SELECT agent_keys.id, uploads.id, ?2 FROM agent_keys, uploads WHERE agent_keys.key_hash = ?1").bind(keyHash, NOW),
    ]);
    const secret = await submit("first");
    expect(await linkAgentKey(env.DB, await hashReceiptSecret(secret), keyHash, NOW)).toEqual({ kind: "full" });
    // One already linked can still be linked again: repeating changes nothing.
    expect(await linkAgentKey(env.DB, String(0).padStart(64, "0"), keyHash, NOW)).toEqual({ kind: "linked", submissions: MAX_UPLOADS_PER_KEY });
  });
});

describe("revoking a key", () => {
  it("deletes the key and every link, and says so only once", async () => {
    const a = await submit("first");
    const key = newAgentKey();
    const keyHash = await hashAgentKey(key);
    await linkAgentKey(env.DB, await hashReceiptSecret(a), keyHash, NOW);
    expect(await revokeAgentKey(env.DB, keyHash)).toBe(true);
    expect(await keyUploads(env.DB, keyHash)).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_key_uploads").first()).toEqual({ n: 0 });
    expect(await revokeAgentKey(env.DB, keyHash)).toBe(false);
  });

  it("goes with the submissions when the test period is wiped", async () => {
    const a = await submit("first");
    const keyHash = await hashAgentKey(newAgentKey());
    await linkAgentKey(env.DB, await hashReceiptSecret(a), keyHash, NOW);
    await reset();
    expect(await keyUploads(env.DB, keyHash)).toBeNull();
  });
});

describe("the agent key endpoints", () => {
  it("link with the receipt in the header and only the key's hash in the body", async () => {
    const secret = await submit("first");
    const key = newAgentKey();
    const response = await link(secret, { keyHash: await hashAgentKey(key) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, submissions: 1 });
    expect(await keyUploads(env.DB, await hashAgentKey(key))).toHaveLength(1);
  });

  it("refuse a link without a receipt, with a malformed hash, for no submission, or for a withdrawn one", async () => {
    const secret = await submit("first");
    const keyHash = await hashAgentKey(newAgentKey());
    const missingReceipt = await call("/api/agent-keys", { method: "POST", body: JSON.stringify({ keyHash }) });
    expect(missingReceipt.status).toBe(400);
    expect(await missingReceipt.json()).toMatchObject({ issues: [{ code: "invalid_receipt" }] });
    for (const body of [{}, { keyHash: newAgentKey() }, { keyHash: keyHash.toUpperCase() }, "not json"]) {
      const response = await call("/api/agent-keys", { method: "POST", headers: { authorization: `Receipt ${secret}` }, body: typeof body === "string" ? body : JSON.stringify(body) });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ issues: [{ code: "invalid_key_hash" }] });
    }
    expect((await link(newReceiptSecret(), { keyHash })).status).toBe(404);
    await withdraw(secret);
    const withdrawn = await link(secret, { keyHash });
    expect(withdrawn.status).toBe(409);
    expect(await withdrawn.json()).toMatchObject({ issues: [{ code: "submission_withdrawn", key: "api.submissionWithdrawn" }] });
  });

  it("refuse a body larger than a link needs", async () => {
    const secret = await submit("first");
    const response = await call("/api/agent-keys", { method: "POST", headers: { authorization: `Receipt ${secret}` }, body: JSON.stringify({ keyHash: "a".repeat(64), pad: "x".repeat(2000) }) });
    expect(response.status).toBe(400);
  });

  it("revoke with the key itself, reporting whether one matched", async () => {
    const secret = await submit("first");
    const key = newAgentKey();
    await link(secret, { keyHash: await hashAgentKey(key) });
    expect(await (await revoke(key)).json()).toEqual({ ok: true, revoked: true });
    expect(await (await revoke(key)).json()).toEqual({ ok: true, revoked: false });
    const malformed = await call("/api/agent-key/revoke", { method: "POST", headers: { authorization: `Agent ${secret}` } });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ issues: [{ code: "invalid_agent_key" }] });
  });
});
