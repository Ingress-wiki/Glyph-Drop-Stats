/**
 * The part of the D1 API this code uses. Code that touches the database
 * takes this type, not `D1Database`, so it type-checks and runs under Node
 * tests against a local D1 from Wrangler's platform proxy as well as in the
 * Worker.
 */

export type SqlValue = string | number | null;

export interface DbStatement {
  bind(...values: SqlValue[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface Db {
  prepare(query: string): DbStatement;
  /** Runs the statements in one transaction: all of them apply, or none. */
  batch(statements: DbStatement[]): Promise<unknown[]>;
}

/**
 * Splits rows into groups whose JSON stays under `maxBytes`, for bulk
 * inserts through one bound parameter and `json_each`. That keeps the
 * number of statements small whatever the file size: D1 limits bound
 * parameters per statement and queries per invocation.
 */
export function jsonChunks(rows: readonly unknown[], maxBytes = 512 * 1024): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 2;
  for (const row of rows) {
    const json = JSON.stringify(row);
    if (current.length > 0 && size + json.length + 1 > maxBytes) {
      chunks.push(`[${current.join(",")}]`);
      current = [];
      size = 2;
    }
    current.push(json);
    size += json.length + 1;
  }
  if (current.length > 0) chunks.push(`[${current.join(",")}]`);
  return chunks;
}

/**
 * `INSERT … SELECT` over a JSON array of row arrays, one bound parameter.
 * `onConflict` decides whether a duplicate key is ignored (for
 * content-addressed rows that are identical by construction) or fails the
 * whole batch (for rows whose uniqueness is the point).
 */
export function bulkInsert(
  db: Db,
  table: string,
  columns: readonly string[],
  chunkJson: string,
  onConflict: "ignore" | "fail",
): DbStatement {
  const values = [...columns.keys()].map((index) => `json_extract(value, '$[${index}]')`).join(", ");
  const conflict = onConflict === "ignore" ? " WHERE true ON CONFLICT DO NOTHING" : "";
  return db
    .prepare(`INSERT INTO ${table} (${columns.join(", ")}) SELECT ${values} FROM json_each(?1)${conflict}`)
    .bind(chunkJson);
}
