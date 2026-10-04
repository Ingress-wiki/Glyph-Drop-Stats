import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleApi } from "../src/worker/api.ts";

const SAMPLE = readFileSync(new URL("./fixtures/sample-v1.csv", import.meta.url));

const post = (body: string | Uint8Array, headers: Record<string, string> = {}) =>
  handleApi(new Request("https://stats.test/api/preview", { method: "POST", body, headers }));

describe("API", () => {
  it("answers the health check", async () => {
    const response = await handleApi(new Request("https://stats.test/api/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("previews an export without echoing its contents", async () => {
    const response = await post(SAMPLE);
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
    });
    expect(JSON.stringify(body)).not.toContain("Hypercube");
  });

  it("rejects a file that isn't an export", async () => {
    const response = await post("hello\r\n");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, issues: [{ code: "not_gear_export" }] });
  });

  it("refuses an oversized upload before reading it", async () => {
    const response = await post("x", { "content-length": String(1024 * 1024 * 1024) });
    expect(response.status).toBe(413);
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
    const request = new Request("https://stats.test/api/preview", { method: "POST", body, duplex: "half" } as RequestInit);
    const response = await handleApi(request);
    expect(response.status).toBe(413);
    // 20 MiB limit, 1 MiB chunks: it stops on the 21st chunk instead of draining an endless stream.
    expect(pulled).toBeLessThanOrEqual(22);
  });

  it("rejects wrong methods and unknown paths", async () => {
    expect((await handleApi(new Request("https://stats.test/api/preview"))).status).toBe(405);
    expect((await handleApi(new Request("https://stats.test/api/nope"))).status).toBe(404);
  });
});
