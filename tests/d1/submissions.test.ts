import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseExport } from "../../src/domain/importer.ts";
import { contentHash } from "../../src/domain/normalize.ts";
import { hashReceiptSecret, newReceiptSecret } from "../../src/domain/receipt.ts";
import type { Db } from "../../src/worker/db.ts";
import {
  classify,
  confirmSubmission,
  loadVersions,
  prepareSubmission,
  type SubmissionInput,
} from "../../src/worker/submissions.ts";
import { localD1 } from "../helpers/d1.ts";
import { csv, fullHackRows, HACK_ID, hackId, hackRecord, item, type Row } from "../helpers/export.ts";

const NOW = Date.UTC(2026, 9, 4) / 1000;
const SAMPLE = new Uint8Array(readFileSync(new URL("../fixtures/sample-v1.csv", import.meta.url)));

let db: Db;
let reset: () => Promise<void>;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const d1 = await localD1();
  db = d1.db;
  reset = d1.reset;
  dispose = d1.dispose;
});
beforeEach(() => reset());
afterAll(() => dispose());

function input(file: Uint8Array<ArrayBuffer> | string, secret = newReceiptSecret()): SubmissionInput {
  const fileBytes = typeof file === "string" ? new TextEncoder().encode(file) : file;
  const parsed = parseExport(fileBytes, { now: NOW });
  if (!parsed.ok) throw new Error(`file rejected: ${JSON.stringify(parsed.issues)}`);
  return { secret, fileBytes, parsed, now: NOW };
}

async function confirmed(file: Uint8Array<ArrayBuffer> | string, secret?: string) {
  const result = await confirmSubmission(db, input(file, secret));
  if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
  return result.summary;
}

async function scalar(sql: string, ...values: (string | number)[]): Promise<unknown> {
  const row = await db
    .prepare(sql)
    .bind(...values)
    .first<Record<string, unknown>>();
  return row ? Object.values(row)[0] : null;
}

const countedIds = async () =>
  (await db.prepare("SELECT record_id FROM counted_records ORDER BY record_id").all<{ record_id: string }>()).results.map(
    (row) => row.record_id,
  );

const acceptedHash = (recordId: string) =>
  scalar("SELECT version_hash FROM accepted_versions WHERE record_id = ?1", recordId);

/** Marks an upload withdrawn the way milestone 3 will, to test what counting does. */
async function withdrawUpload(secret: string): Promise<void> {
  await db
    .prepare("UPDATE uploads SET status = 'withdrawn', withdrawn_at = ?2 WHERE secret_hash = ?1")
    .bind(await hashReceiptSecret(secret), NOW)
    .run();
}

const NO_READING: Row = {
  read_status: "unavailable",
  association: "",
  observed_panels_read_in_full: "",
  both_panels_read: "",
};

const DAY: Row = {
  time_bucket_start_utc: "2026-10-02T16:00:00Z",
  time_bucket_end_utc: "2026-10-03T16:00:00Z",
  local_hour: "",
};

describe("storage", () => {
  it("stores versions that read back exactly, with the same hash", async () => {
    const { parsed } = input(SAMPLE);
    await confirmed(SAMPLE);
    const records = parsed.records.map((entry) => entry.record);
    const hashes = await Promise.all(records.map(contentHash));
    const stored = await loadVersions(db, hashes);
    for (const [index, record] of records.entries()) {
      expect(stored.get(hashes[index])).toEqual(record);
    }
  });

  it("stores an upload too large for one bulk statement per table", async () => {
    const rows: Row[] = [];
    for (let n = 0; n < 300; n++) {
      const [portal, , bonus] = fullHackRows({ record_id: hackId(n), order: String(n + 1) });
      for (let slot = 0; slot < 13; slot++) rows.push({ ...portal, slot: String(slot) });
      for (let slot = 0; slot < 12; slot++) rows.push({ ...bonus, slot: String(slot) });
    }
    const prepared = await prepareSubmission(db, input(csv(rows)));
    await db.batch(prepared.statements);
    expect(await scalar("SELECT COUNT(*) FROM items")).toBe(7500);
    expect(await scalar("SELECT COUNT(*) FROM counted_records")).toBe(300);
  });
});

describe("classification against the accepted version", () => {
  it("counts a re-export once and keeps both uploads' links", async () => {
    await confirmed(SAMPLE);
    const second = await confirmed(SAMPLE);
    expect(second.outcomes).toMatchObject({ new: 0, duplicate: 3 });
    expect(await scalar("SELECT COUNT(*) FROM upload_records")).toBe(6);
    expect((await countedIds()).length).toBe(3);
  });

  it("treats a change of time precision as a duplicate and keeps the accepted time", async () => {
    await confirmed(csv(fullHackRows()));
    const before = await acceptedHash(HACK_ID);
    const daily = await confirmed(csv(fullHackRows(DAY)));
    expect(daily.outcomes).toMatchObject({ duplicate_other_precision: 1 });
    expect(await acceptedHash(HACK_ID)).toBe(before);
  });

  it("holds a late gear reading as an update candidate without changing the accepted version", async () => {
    await confirmed(csv([hackRecord(NO_READING)]));
    const before = await acceptedHash(HACK_ID);
    const later = await confirmed(csv(fullHackRows()));
    expect(later.outcomes).toMatchObject({ update_candidate: 1 });
    expect(await acceptedHash(HACK_ID)).toBe(before);
    expect(await scalar("SELECT COUNT(*) FROM record_versions WHERE record_id = ?1", HACK_ID)).toBe(2);
    expect(await scalar("SELECT outcome FROM upload_records WHERE version_hash != ?1", String(before))).toBe(
      "update_candidate",
    );
  });

  it("stores altered content as a conflict and never lets it count", async () => {
    await confirmed(csv(fullHackRows()));
    const altered = fullHackRows();
    altered[0].quantity = "9";
    const result = await confirmed(csv(altered));
    expect(result.outcomes).toMatchObject({ conflict: 1 });
    const counted = await db.prepare("SELECT version_hash FROM counted_records").all<{ version_hash: string }>();
    expect(counted.results.map((row) => row.version_hash)).toEqual([await acceptedHash(HACK_ID)]);
  });
});

describe("withdrawal never promotes", () => {
  it("stops counting a record whose only support is withdrawn, even with a conflict waiting", async () => {
    const original = newReceiptSecret();
    await confirmed(csv(fullHackRows()), original);
    const altered = fullHackRows();
    altered[0].quantity = "9";
    await confirmed(csv(altered));
    const accepted = await acceptedHash(HACK_ID);

    await withdrawUpload(original);
    expect(await countedIds()).toEqual([]);
    expect(await acceptedHash(HACK_ID)).toBe(accepted);
  });

  it("doesn't promote an update candidate either", async () => {
    const original = newReceiptSecret();
    await confirmed(csv([hackRecord(NO_READING)]), original);
    await confirmed(csv(fullHackRows()));
    await withdrawUpload(original);
    expect(await countedIds()).toEqual([]);
  });

  it("keeps counting a record another active upload still supports", async () => {
    const first = newReceiptSecret();
    await confirmed(csv(fullHackRows()), first);
    await confirmed(csv(fullHackRows(DAY)));
    await withdrawUpload(first);
    expect(await countedIds()).toEqual([HACK_ID]);
  });
});

describe("atomicity and concurrency", () => {
  it("leaves nothing behind when the commit fails part-way", async () => {
    const prepared = await prepareSubmission(db, input(SAMPLE));
    // Another upload claims one record between classification and commit.
    await confirmed(csv(fullHackRows()));
    const before = {
      uploads: await scalar("SELECT COUNT(*) FROM uploads"),
      versions: await scalar("SELECT COUNT(*) FROM record_versions"),
      items: await scalar("SELECT COUNT(*) FROM items"),
      links: await scalar("SELECT COUNT(*) FROM upload_records"),
    };
    await expect(db.batch(prepared.statements)).rejects.toThrow(/UNIQUE constraint failed: accepted_versions/);
    expect({
      uploads: await scalar("SELECT COUNT(*) FROM uploads"),
      versions: await scalar("SELECT COUNT(*) FROM record_versions"),
      items: await scalar("SELECT COUNT(*) FROM items"),
      links: await scalar("SELECT COUNT(*) FROM upload_records"),
    }).toEqual(before);
  });

  it("reclassifies and retries when a concurrent upload claims a record first", async () => {
    const secret = newReceiptSecret();
    const prepared = await prepareSubmission(db, input(SAMPLE, secret));
    expect(prepared.summary.outcomes.new).toBe(3);
    await confirmed(csv(fullHackRows()));
    // The prepared batch is stale now; confirming classifies again.
    const result = await confirmSubmission(db, input(SAMPLE, secret));
    expect(result).toMatchObject({ kind: "created", summary: { outcomes: { new: 2, conflict: 1 } } });
    expect(await scalar("SELECT COUNT(*) FROM accepted_versions")).toBe(3);
  });

  it("keeps exactly one accepted version per record under simultaneous uploads", async () => {
    const file = (from: number, to: number) => {
      const rows: Row[] = [];
      for (let n = from; n < to; n++) {
        rows.push({ ...hackRecord({ record_id: hackId(n), order: String(n + 1) }), ...item("portal", 0) });
      }
      return csv(rows.map((row) => ({ ...row, observed_panels_read_in_full: "true", both_panels_read: "false" })));
    };
    const files = [file(0, 40), file(20, 60), file(10, 50), file(0, 60)];
    const results = await Promise.all(files.map((f) => confirmSubmission(db, input(f))));
    expect(results.every((result) => result.kind === "created")).toBe(true);
    const newTotal = results.reduce((sum, result) => sum + (result.kind === "created" ? result.summary.outcomes.new : 0), 0);
    expect(newTotal).toBe(60);
    expect(await scalar("SELECT COUNT(*) FROM accepted_versions")).toBe(60);
    expect(await scalar("SELECT COUNT(*) FROM uploads")).toBe(4);
    expect(await scalar("SELECT COUNT(*) FROM upload_records")).toBe(40 + 40 + 40 + 60);
    expect(await scalar("SELECT COUNT(*) FROM upload_records WHERE outcome = 'duplicate'")).toBe(180 - 60);
  });

  it("confirms only once when the same receipt is sent twice at the same time", async () => {
    const secret = newReceiptSecret();
    const [a, b] = await Promise.all([
      confirmSubmission(db, input(SAMPLE, secret)),
      confirmSubmission(db, input(SAMPLE, secret)),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["created", "replayed"]);
    expect(await scalar("SELECT COUNT(*) FROM uploads")).toBe(1);
    expect(await scalar("SELECT COUNT(*) FROM upload_records")).toBe(3);
  });

  it("returns the original result when the response was lost and the upload is retried", async () => {
    const secret = newReceiptSecret();
    const first = await confirmSubmission(db, input(SAMPLE, secret));
    // A second upload changes what a fresh classification would say...
    await confirmed(csv(fullHackRows()));
    // ...but the retry reports what was committed the first time.
    const retry = await confirmSubmission(db, input(SAMPLE, secret));
    expect(first.kind).toBe("created");
    expect(retry).toEqual({ kind: "replayed", summary: first.kind === "created" ? first.summary : null });
  });

  it("classifies without writing anything", async () => {
    const { parsed } = input(SAMPLE);
    await classify(
      db,
      parsed.records.map((entry) => entry.record),
    );
    expect(await scalar("SELECT COUNT(*) FROM record_versions")).toBe(0);
  });
});
