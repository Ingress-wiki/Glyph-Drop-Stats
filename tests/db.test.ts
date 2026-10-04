import { describe, expect, it } from "vitest";
import { jsonChunks } from "../src/worker/db.ts";

describe("jsonChunks", () => {
  it("keeps every row, in order, as JSON arrays under the size limit", () => {
    const rows = [...Array(100).keys()].map((n) => ["row", n]);
    const chunks = jsonChunks(rows, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200);
    expect(chunks.flatMap((chunk) => JSON.parse(chunk))).toEqual(rows);
  });

  it("puts a row larger than the limit in a chunk of its own", () => {
    const chunks = jsonChunks(["x".repeat(50), "y"], 20);
    expect(chunks.map((chunk) => JSON.parse(chunk))).toEqual([["x".repeat(50)], ["y"]]);
  });

  it("returns no chunks for no rows", () => {
    expect(jsonChunks([])).toEqual([]);
  });
});
