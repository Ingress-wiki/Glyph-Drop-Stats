import { describe, expect, it } from "vitest";
import { parseExport } from "../src/domain/importer.ts";
import { canonicalJson, contentHash } from "../src/domain/normalize.ts";
import { bytes, csv, fullHackRows, hackRecord, type Row } from "./helpers/export.ts";

const NOW = Date.UTC(2026, 9, 4) / 1000;

async function hashOf(rows: Row[]): Promise<string> {
  const result = parseExport(bytes(csv(rows)), { now: NOW });
  if (!result.ok || result.records.length !== 1) throw new Error("expected one record");
  return contentHash(result.records[0].record);
}

describe("canonicalJson", () => {
  it("sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[{"x":2,"y":1}]},"b":1}');
  });
});

describe("contentHash", () => {
  it("ignores export-only columns", async () => {
    const first = await hashOf(fullHackRows());
    const reexported = await hashOf(
      fullHackRows({ session: "4", order: "17", exporter_app_version: "0.2.0", exporter_app_build: "90" }),
    );
    expect(reexported).toBe(first);
  });

  it("ignores the order of a panel's item rows", async () => {
    const [first, second, bonus] = fullHackRows();
    expect(await hashOf([second, first, bonus])).toBe(await hashOf([first, second, bonus]));
  });

  it("changes when gear arrives after an earlier export", async () => {
    const before = await hashOf([
      hackRecord({ read_status: "unavailable", association: "", observed_panels_read_in_full: "", both_panels_read: "" }),
    ]);
    expect(await hashOf(fullHackRows())).not.toBe(before);
  });

  it("tells unknown apart from false", async () => {
    const unknown = fullHackRows();
    unknown[0].multiplied = "";
    const no = fullHackRows();
    no[0].multiplied = "false";
    expect(await hashOf(unknown)).not.toBe(await hashOf(no));
  });
});
