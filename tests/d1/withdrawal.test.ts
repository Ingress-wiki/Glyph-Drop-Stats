import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newReceiptSecret } from "../../src/domain/receipt.ts";
import { handleApi, type ApiEnv } from "../../src/worker/api.ts";
import { localD1 } from "../helpers/d1.ts";
import { csv, fullHackRows, hackId, type Row } from "../helpers/export.ts";

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

const call = (path: string, secret: string | null, init: RequestInit = {}) =>
  handleApi(
    new Request(`https://stats.test${path}`, {
      ...init,
      headers: secret === null ? {} : { authorization: `Receipt ${secret}` },
    }),
    env,
  );

/** A file holding one fully read hack per id. */
function exportOf(...ids: number[]): string {
  const rows: Row[] = [];
  ids.forEach((id, index) => rows.push(...fullHackRows({ record_id: hackId(id), order: String(index + 1) })));
  return csv(rows);
}

async function submitted(file: string): Promise<string> {
  const secret = newReceiptSecret();
  const response = await call("/api/submissions", secret, { method: "POST", body: file });
  expect(response.status).toBe(201);
  return secret;
}

const withdraw = (secret: string | null) => call("/api/submission/withdraw", secret, { method: "POST" });

async function counted(): Promise<string[]> {
  const rows = await env.DB.prepare("SELECT record_id FROM counted_records ORDER BY record_id").all<{ record_id: string }>();
  return rows.results.map((row) => row.record_id);
}

describe("authorization", () => {
  it("requires a receipt and changes nothing without the right one", async () => {
    await submitted(exportOf(1));
    expect((await withdraw(null)).status).toBe(400);
    expect((await withdraw("gds1_not-a-receipt")).status).toBe(400);
    expect((await withdraw(newReceiptSecret())).status).toBe(404);
    expect(await counted()).toEqual([hackId(1)]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM uploads WHERE status = 'withdrawn'").first()).toEqual({ n: 0 });
  });

  it("can't be triggered by a record id or a GET", async () => {
    await submitted(exportOf(1));
    expect((await call(`/api/submission/withdraw?record=${hackId(1)}`, null, { method: "POST" })).status).toBe(400);
    expect((await call("/api/submission/withdraw", newReceiptSecret())).status).toBe(405);
    expect(await counted()).toEqual([hackId(1)]);
  });
});

describe("withdrawal", () => {
  it("removes the submission's contribution and reports it", async () => {
    const secret = await submitted(exportOf(1, 2));
    const response = await withdraw(secret);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { alreadyWithdrawn: boolean; submission: { status: string; withdrawnAt: number } };
    expect(body).toMatchObject({ ok: true, alreadyWithdrawn: false, submission: { status: "withdrawn" } });
    expect(body.submission.withdrawnAt).toBeGreaterThan(0);
    expect(await counted()).toEqual([]);
    const status = await call("/api/submission", secret);
    expect(await status.json()).toMatchObject({ submission: { status: "withdrawn", withdrawnAt: body.submission.withdrawnAt } });
  });

  it("is idempotent: withdrawing again changes nothing and says so", async () => {
    const secret = await submitted(exportOf(1));
    const first = (await (await withdraw(secret)).json()) as { submission: unknown };
    const again = await withdraw(secret);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, alreadyWithdrawn: true, submission: first.submission });
  });

  it("settles simultaneous withdrawals once", async () => {
    const secret = await submitted(exportOf(1));
    const bodies = await Promise.all([withdraw(secret), withdraw(secret)].map(async (r) => (await r).json()));
    expect(bodies.map((body) => (body as { alreadyWithdrawn: boolean }).alreadyWithdrawn).sort()).toEqual([false, true]);
  });

  it("doesn't reactivate when the original confirmation is retried afterwards", async () => {
    const file = exportOf(1);
    const secret = await submitted(file);
    await withdraw(secret);
    const retry = await call("/api/submissions", secret, { method: "POST", body: file });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ replayed: true, submission: { status: "withdrawn" } });
    expect(await counted()).toEqual([]);
  });
});

describe("overlapping submissions", () => {
  it("keeps records another active submission supplied, and drops the rest", async () => {
    const a = await submitted(exportOf(1, 2));
    const b = await submitted(exportOf(2, 3));
    await withdraw(a);
    expect(await counted()).toEqual([hackId(2), hackId(3)]);
    await withdraw(b);
    expect(await counted()).toEqual([]);
  });

  it("doesn't let one submission's withdrawal erase another's identical records", async () => {
    const a = await submitted(exportOf(1, 2));
    await submitted(exportOf(1, 2));
    await withdraw(a);
    expect(await counted()).toEqual([hackId(1), hackId(2)]);
  });

  it("never promotes a conflicting copy in place of a withdrawn record", async () => {
    const a = await submitted(exportOf(1));
    const altered = fullHackRows({ record_id: hackId(1) });
    altered[0].quantity = "9";
    await submitted(csv(altered));
    await withdraw(a);
    expect(await counted()).toEqual([]);
  });

  it("counts a record again when a later submission supplies the accepted version", async () => {
    const a = await submitted(exportOf(1));
    await withdraw(a);
    await submitted(exportOf(1));
    expect(await counted()).toEqual([hackId(1)]);
  });
});
