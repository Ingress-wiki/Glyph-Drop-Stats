import { afterEach, describe, expect, it, vi } from "vitest";
import { computeStatistics, NO_FILTER } from "../src/domain/statistics.ts";
import { confirmUpload, fetchStatistics, isStatistics, submissionStatus, withdrawUpload } from "../src/web/api.ts";

const SECRET = `gds1_${"a".repeat(43)}`;
const FILE = new File(["format_version\r\n"], "export.csv", { type: "text/csv" });

const SUMMARY = {
  status: "completed",
  createdAt: 1_791_158_163,
  withdrawnAt: null,
  rowCount: 7,
  rejected: 0,
  outcomes: { new: 3, duplicate: 0, duplicate_other_precision: 0, update_candidate: 0, conflict: 0 },
};

function answer(response: Response | Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
  );
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("confirmUpload", () => {
  it("reports a confirmed upload, sending the receipt only in the Authorization header", async () => {
    answer(json(201, { ok: true, replayed: false, submission: SUMMARY }));
    expect(await confirmUpload(FILE, SECRET)).toEqual({ kind: "submitted", replayed: false, submission: SUMMARY });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/submissions");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Receipt ${SECRET}`);
  });

  it("reports a replayed confirmation", async () => {
    answer(json(200, { ok: true, replayed: true, submission: SUMMARY }));
    expect(await confirmUpload(FILE, SECRET)).toMatchObject({ kind: "submitted", replayed: true });
  });

  it("treats a truncated success body as uncertain, not refused", async () => {
    answer(new Response('{"ok":true,"replayed":false,"submission":{"sta', { status: 201 }));
    expect(await confirmUpload(FILE, SECRET)).toMatchObject({ kind: "uncertain" });
  });

  it("treats a connection lost while reading the body as uncertain", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":true,'));
        controller.error(new TypeError("network connection lost"));
      },
    });
    answer(new Response(body, { status: 201 }));
    expect(await confirmUpload(FILE, SECRET)).toMatchObject({ kind: "uncertain" });
  });

  it("treats a success without a valid summary as uncertain", async () => {
    answer(json(201, { ok: true }));
    expect(await confirmUpload(FILE, SECRET)).toMatchObject({ kind: "uncertain" });
    answer(json(201, { ok: true, replayed: false, submission: { ...SUMMARY, outcomes: { new: 3 } } }));
    expect(await confirmUpload(FILE, SECRET)).toMatchObject({ kind: "uncertain" });
  });

  it("treats a failed request and server errors as uncertain", async () => {
    answer(new TypeError("Failed to fetch"));
    expect(await confirmUpload(FILE, SECRET)).toEqual({ kind: "uncertain", problem: { kind: "network", detail: "Failed to fetch" } });
    answer(json(500, { ok: false, issues: [{ code: "x", message: "y" }] }));
    expect(await confirmUpload(FILE, SECRET)).toEqual({ kind: "uncertain", problem: { kind: "unclear", status: 500 } });
    answer(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(await confirmUpload(FILE, SECRET)).toMatchObject({ kind: "uncertain" });
  });

  it("reports a clear refusal as refused", async () => {
    const issues = [{ code: "receipt_in_use", message: "This receipt was already used for a different file." }];
    answer(json(409, { ok: false, issues }));
    expect(await confirmUpload(FILE, SECRET)).toEqual({ kind: "refused", issues });
  });

  it("treats an unreadable refusal as uncertain", async () => {
    answer(new Response('{"ok":fal', { status: 409 }));
    expect(await confirmUpload(FILE, SECRET)).toMatchObject({ kind: "uncertain" });
  });
});

describe("submissionStatus", () => {
  it("reports a found submission", async () => {
    answer(json(200, { ok: true, submission: SUMMARY }));
    expect(await submissionStatus(SECRET)).toEqual({ kind: "found", submission: SUMMARY });
  });

  it("rejects a success without a valid summary", async () => {
    answer(json(200, { ok: true }));
    expect(await submissionStatus(SECRET)).toMatchObject({ kind: "failed" });
  });

  it("reports an unknown receipt", async () => {
    answer(json(404, { ok: false, issues: [{ code: "not_found", message: "No submission has this receipt." }] }));
    expect(await submissionStatus(SECRET)).toMatchObject({ kind: "refused", issues: [{ code: "not_found" }] });
  });

  it("lets an aborted lookup reject, so a newer lookup can replace it", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe("/api/submission");
        if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return json(200, { ok: true, submission: SUMMARY });
      }),
    );
    await expect(submissionStatus(SECRET, controller.signal)).rejects.toThrow("aborted");
  });
});

describe("withdrawUpload", () => {
  const WITHDRAWN = { ...SUMMARY, status: "withdrawn", withdrawnAt: 1_791_160_000 };

  it("reports a withdrawal and an earlier one", async () => {
    answer(json(200, { ok: true, alreadyWithdrawn: false, submission: WITHDRAWN }));
    expect(await withdrawUpload(SECRET)).toEqual({ kind: "withdrawn", alreadyWithdrawn: false, submission: WITHDRAWN });
    answer(json(200, { ok: true, alreadyWithdrawn: true, submission: WITHDRAWN }));
    expect(await withdrawUpload(SECRET)).toMatchObject({ kind: "withdrawn", alreadyWithdrawn: true });
  });

  it("treats a lost or inconsistent answer as uncertain", async () => {
    answer(new Response('{"ok":tr', { status: 200 }));
    expect(await withdrawUpload(SECRET)).toMatchObject({ kind: "uncertain" });
    answer(json(200, { ok: true, alreadyWithdrawn: false, submission: SUMMARY }));
    expect(await withdrawUpload(SECRET)).toMatchObject({ kind: "uncertain" });
    answer(new TypeError("Failed to fetch"));
    expect(await withdrawUpload(SECRET)).toMatchObject({ kind: "uncertain" });
  });

  it("reports an unknown receipt as refused", async () => {
    answer(json(404, { ok: false, issues: [{ code: "not_found", message: "No submission has this receipt." }] }));
    expect(await withdrawUpload(SECRET)).toMatchObject({ kind: "refused" });
  });
});

describe("summary validation", () => {
  it("requires withdrawnAt to match the status", async () => {
    answer(json(200, { ok: true, submission: { ...SUMMARY, withdrawnAt: 5 } }));
    expect(await submissionStatus(SECRET)).toMatchObject({ kind: "failed" });
    answer(json(200, { ok: true, submission: { ...SUMMARY, status: "withdrawn" } }));
    expect(await submissionStatus(SECRET)).toMatchObject({ kind: "failed" });
  });
});

describe("fetchStatistics", () => {
  const valid = () => computeStatistics([], NO_FILTER);
  const withItem = () => {
    const statistics = valid();
    statistics.items.eligible = 1;
    statistics.items.byItem = [
      {
        item: "Resonator",
        quantity: 2,
        averagePerObservation: 2,
        multiplied: 0,
        multipliedUnknown: 0,
        levels: [0, 0, 0, 0, 0, 2, 0, 0],
      },
    ];
    return statistics;
  };
  const answerWith = (statistics: unknown) => answer(json(200, { ok: true, statistics }));

  it("accepts a complete answer", async () => {
    answerWith(withItem());
    expect(await fetchStatistics("")).toMatchObject({ kind: "ok" });
    expect(isStatistics(valid())).toBe(true);
  });

  it("fails cleanly on an answer missing what the dashboard reads", async () => {
    const broken = valid() as unknown as { records: Record<string, unknown>; selection: Record<string, unknown> };
    delete broken.records.byKind;
    delete broken.records.byCoverage;
    delete broken.selection.unplaced;
    answerWith(broken);
    expect(await fetchStatistics("")).toMatchObject({ kind: "failed" });
  });

  it("rejects each missing or malformed field", () => {
    const cases: [string, (s: Record<string, any>) => void][] = [
      ["unplaced reason", (s) => delete s.selection.unplaced.no_local_time],
      ["kind count", (s) => (s.records.byKind.drop = -1)],
      ["read status", (s) => delete s.records.byReadStatus.unsupported],
      ["coverage", (s) => (s.records.byCoverage.partly_read = "3")],
      ["panels", (s) => (s.items.panels = "all")],
      ["exclusion", (s) => delete s.items.excluded.unlisted_item_names],
      ["total quantity", (s) => (s.items.totalQuantity = 1.5)],
      ["average", (s) => (s.items.averagePerObservation = Number.NaN)],
      ["item rows", (s) => (s.items.byItem = {})],
      ["item name", (s) => (s.items.byItem[0].item = null)],
      ["item average", (s) => (s.items.byItem[0].averagePerObservation = -1)],
      ["level array length", (s) => (s.items.byItem[0].levels = [1, 2, 3])],
      ["level value", (s) => (s.items.byItem[0].levels[5] = null)],
      ["multiplied", (s) => delete s.items.byItem[0].multipliedUnknown],
    ];
    for (const [name, breakIt] of cases) {
      // A test fixture deliberately broken field by field; the validator is what's under test.
      const statistics = structuredClone(withItem()) as unknown as Record<string, any>;
      breakIt(statistics);
      expect([name, isStatistics(statistics)]).toEqual([name, false]);
    }
  });
});
