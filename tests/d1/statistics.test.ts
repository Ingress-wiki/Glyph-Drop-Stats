import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newReceiptSecret } from "../../src/domain/receipt.ts";
import type { Statistics } from "../../src/domain/statistics.ts";
import { handleApi, type ApiEnv } from "../../src/worker/api.ts";
import { localD1 } from "../helpers/d1.ts";
import { datasetCsv, datasetRecords, EXPECTED } from "../helpers/dataset.ts";
import { csv, hackId, hackRecord, item, type Row } from "../helpers/export.ts";

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

const call = (path: string, init: RequestInit = {}) => handleApi(new Request(`https://stats.test${path}`, init), env);

async function submit(file: string): Promise<{ secret: string; outcomes: Record<string, number> }> {
  const secret = newReceiptSecret();
  const response = await call("/api/submissions", { method: "POST", body: file, headers: { authorization: `Receipt ${secret}` } });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { submission: { outcomes: Record<string, number> } };
  return { secret, outcomes: body.submission.outcomes };
}

async function withdraw(secret: string): Promise<void> {
  const response = await call("/api/submission/withdraw", { method: "POST", headers: { authorization: `Receipt ${secret}` } });
  expect(response.status).toBe(200);
}

async function stats(query = ""): Promise<Statistics> {
  const response = await call(`/api/statistics${query ? `?${query}` : ""}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return ((await response.json()) as { statistics: Statistics }).statistics;
}

const filesOf = (records: Row[][]) => csv(records.flat());

describe("statistics from submitted data", () => {
  it("match the hand-calculated dataset", async () => {
    await submit(datasetCsv());
    const result = await stats();
    expect(result.records).toEqual(EXPECTED.records);
    expect(result.items).toEqual({ panels: "portal", ...EXPECTED.portalItems });
  });

  it("are empty, not zero-filled averages, before anything is submitted", async () => {
    const result = await stats();
    expect(result.records.total).toBe(0);
    expect(result.items.averagePerObservation).toBeNull();
  });

  it("count a record once however many submissions supply it", async () => {
    await submit(datasetCsv());
    await submit(datasetCsv());
    const result = await stats();
    expect(result.records.total).toBe(10);
    expect(result.items.totalQuantity).toBe(EXPECTED.portalItems.totalQuantity);
  });
});

describe("withdrawal", () => {
  it("changes the very next response, keeping records another submission supports", async () => {
    const records = datasetRecords();
    // A supplies h1–h6; B supplies h4–h6 and the rest. Together they are the whole dataset.
    const a = await submit(filesOf(records.slice(0, 6)));
    const b = await submit(filesOf(records.slice(3)));
    expect((await stats()).records).toEqual(EXPECTED.records);

    await withdraw(a.secret);
    const afterA = await stats();
    // Left: h4 h5 h6 (still supported by B), d h8 h9 h10.
    expect(afterA.records.total).toBe(7);
    expect(afterA.items).toEqual({
      panels: "portal",
      eligible: 3, // d, h9, h10
      excluded: { no_reading: 1, panel_not_seen: 1, partly_read: 0, unidentified_items: 1, unlisted_item_names: 1 },
      totalQuantity: 4,
      averagePerObservation: 4 / 3,
      byItem: [
        // Power Cube L8 ×2 (drop); Resonator L6 ×1 each (h9, h10).
        {
          item: "Power Cube",
          quantity: 2,
          averagePerObservation: 2 / 3,
          multiplied: 0,
          multipliedUnknown: 0,
          levels: [0, 0, 0, 0, 0, 0, 0, 2],
        },
        {
          item: "Resonator",
          quantity: 2,
          averagePerObservation: 2 / 3,
          multiplied: 0,
          multipliedUnknown: 0,
          levels: [0, 0, 0, 0, 0, 2, 0, 0],
        },
      ],
    });

    await withdraw(b.secret);
    const afterBoth = await stats();
    expect(afterBoth.records.total).toBe(0);
    expect(afterBoth.items.averagePerObservation).toBeNull();
  });
});

describe("versions that don't count", () => {
  it("ignore a conflicting copy", async () => {
    await submit(datasetCsv());
    const altered = datasetRecords()[1].map((row) => ({ ...row, quantity: "9" }));
    expect((await submit(csv(altered))).outcomes.conflict).toBe(1);
    const result = await stats();
    expect(result.items).toEqual({ panels: "portal", ...EXPECTED.portalItems });
  });

  it("ignore a late gear reading until it is reviewed", async () => {
    await submit(datasetCsv());
    // h6 again, now read: same hack result, a portal panel with five Resonators.
    const h6 = hackRecord({
      record_id: hackId(6),
      observed_panels_read_in_full: "true",
      both_panels_read: "false",
      portal_level_low: "",
      portal_level_high: "",
      portal_level_confidence: "",
      portal_level_conflict: "",
      hacking_bonus_final: "false",
    });
    const late = csv([{ ...h6, ...item("portal", 0, { quantity: "5", multiplied: "false" }) }]);
    expect((await submit(late)).outcomes.update_candidate).toBe(1);
    const result = await stats();
    expect(result.records.byReadStatus.unavailable).toBe(1);
    expect(result.items).toEqual({ panels: "portal", ...EXPECTED.portalItems });
  });
});

describe("filters through the API", () => {
  it("apply a UTC range and report intervals crossing its boundary", async () => {
    await submit(datasetCsv());
    const inside = await stats("utcFrom=2026-10-02T23:00:00Z&utcTo=2026-10-03T00:00:00Z");
    expect(inside.selection.matched).toBe(9);
    expect(inside.selection.unplaced.crosses_utc_boundary).toBe(1);
    const later = await stats("utcFrom=2026-10-03T00:00:00Z&utcTo=2026-10-04T00:00:00Z");
    expect(later.selection.matched).toBe(0);
    expect(later.selection.unplaced.crosses_utc_boundary).toBe(1);
    const before = await stats("utcFrom=2026-10-01T00:00:00Z&utcTo=2026-10-02T00:00:00Z");
    expect(before.selection.matched).toBe(0);
    expect(before.selection.unplaced.crosses_utc_boundary).toBe(0);
  });

  it("apply level, bonus and panel filters", async () => {
    await submit(datasetCsv());
    const result = await stats("portalLevelMin=6&portalLevelMax=6&hackingBonusMin=100&hackingBonusMax=200&panels=both");
    // In: h1 h3 h4 h5 h8 h9 (level 6, bonus 120 final). Out: h2 (level 5).
    // Unplaced: h6 and the drop have no portal level; h10's range 5–6 crosses the filter.
    expect(result.selection.matched).toBe(6);
    expect(result.selection.unplaced.no_portal_level).toBe(2);
    expect(result.selection.unplaced.portal_level_crosses_filter).toBe(1);
    // Of the six, only h1 has both panels.
    expect(result.items.eligible).toBe(1);
  });

  it("refuse an invalid filter", async () => {
    const response = await call("/api/statistics?portalLevelMin=6");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      issues: [{ code: "invalid_filter", key: "filter.pair", params: { first: "portalLevelMin", second: "portalLevelMax" } }],
    });
  });
});
