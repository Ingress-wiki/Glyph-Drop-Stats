import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newReceiptSecret } from "../../src/domain/receipt.ts";
import { handleApi, type ApiEnv } from "../../src/worker/api.ts";
import { localD1 } from "../helpers/d1.ts";
import { bytes, csv, fullHackRows, hackId } from "../helpers/export.ts";

const SAMPLE = new Uint8Array(readFileSync(new URL("../fixtures/sample-v1.csv", import.meta.url)));

let env: ApiEnv;
let reset: () => Promise<void>;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const d1 = await localD1();
  env = { DB: d1.db };
  reset = d1.reset;
  dispose = d1.dispose;
});
beforeEach(() => reset());
afterAll(() => dispose());

function call(path: string, init: RequestInit = {}) {
  return handleApi(new Request(`https://stats.test${path}`, init), env);
}

const preview = (body: Uint8Array | string) => call("/api/preview", { method: "POST", body });

const submit = (body: Uint8Array | string, secret: string | null) =>
  call("/api/submissions", {
    method: "POST",
    body,
    headers: secret === null ? {} : { authorization: `Receipt ${secret}` },
  });

const status = (secret: string) => call("/api/submission", { headers: { authorization: `Receipt ${secret}` } });

describe("health and routing", () => {
  it("answers the health check", async () => {
    const response = await call("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("rejects wrong methods and unknown paths", async () => {
    expect((await call("/api/preview")).status).toBe(405);
    expect((await call("/api/submissions")).status).toBe(405);
    expect((await call("/api/nope")).status).toBe(404);
  });
});

describe("preview", () => {
  it("describes an export without echoing its contents or storing it", async () => {
    const response = await preview(SAMPLE);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      rowCount: 7,
      records: {
        valid: 3,
        rejected: 0,
        byKind: { hack: 2, drop: 1 },
        byReadStatus: { read: 2, notRead: 0, unavailable: 1, unsupported: 0 },
        partlyRead: 1,
      },
      outcomes: { new: 3, duplicate: 0, duplicate_other_precision: 0, update_candidate: 0, conflict: 0 },
    });
    expect(JSON.stringify(body)).not.toContain("Hypercube");
    const uploads = await env.DB.prepare("SELECT COUNT(*) AS n FROM record_versions").first<{ n: number }>();
    expect(uploads?.n).toBe(0);
  });

  it("shows records already submitted as duplicates", async () => {
    expect((await submit(SAMPLE, newReceiptSecret())).status).toBe(201);
    const body = await (await preview(SAMPLE)).json();
    expect(body).toMatchObject({ outcomes: { new: 0, duplicate: 3 } });
  });

  it("rejects a file that isn't an export", async () => {
    const response = await preview("hello\r\n");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      ok: false,
      issues: [{ code: "not_gear_export", key: "file.notGearExport", message: "This is not a DynamicGlyph gear export." }],
    });
  });

  it("stops reading a streamed body without Content-Length once it passes the limit", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const response = await call("/api/preview", { method: "POST", body, duplex: "half" } as RequestInit);
    expect(response.status).toBe(413);
    // 20 MiB limit, 1 MiB chunks: it stops on the 21st chunk instead of draining an endless stream.
    expect(pulled).toBeLessThanOrEqual(22);
  });

  it("refuses an oversized declared length before reading", async () => {
    const response = await call("/api/preview", {
      method: "POST",
      body: "x",
      headers: { "content-length": String(1024 * 1024 * 1024) },
    });
    expect(response.status).toBe(413);
  });
});

describe("submission and receipts", () => {
  it("requires a well-formed receipt in the Authorization header", async () => {
    expect((await submit(SAMPLE, null)).status).toBe(400);
    expect((await submit(SAMPLE, "gds1_tooshort")).status).toBe(400);
  });

  it("confirms an upload and reports it to the receipt holder", async () => {
    const secret = newReceiptSecret();
    const response = await submit(SAMPLE, secret);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { submission: unknown };
    expect(created).toMatchObject({
      ok: true,
      replayed: false,
      submission: { status: "completed", rowCount: 7, rejected: 0, outcomes: { new: 3 } },
    });
    const found = await status(secret);
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ ok: true, submission: created.submission });
  });

  it("answers a retry after a lost response with the original result, counting nothing twice", async () => {
    const secret = newReceiptSecret();
    const first = (await (await submit(SAMPLE, secret)).json()) as { submission: unknown };
    const retry = await submit(SAMPLE, secret);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, replayed: true, submission: first.submission });
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM uploads) AS uploads, (SELECT COUNT(*) FROM upload_records) AS links",
    ).first();
    expect(counts).toEqual({ uploads: 1, links: 3 });
  });

  it("refuses to reuse a receipt for a different file", async () => {
    const secret = newReceiptSecret();
    await submit(SAMPLE, secret);
    const other = csv(fullHackRows({ record_id: hackId(7) }));
    const response = await submit(other, secret);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ issues: [{ code: "receipt_in_use", key: "api.receiptInUse" }] });
  });

  it("refuses a file without valid records and stores nothing", async () => {
    const broken = csv(fullHackRows({ hacking_bonus: "lots" }));
    const response = await submit(bytes(broken), newReceiptSecret());
    expect(response.status).toBe(422);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM uploads").first()).toEqual({ n: 0 });
  });

  it("reports an unknown receipt as not found", async () => {
    expect((await status(newReceiptSecret())).status).toBe(404);
  });
});
