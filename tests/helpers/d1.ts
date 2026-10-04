import { readdirSync, readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import type { Db } from "../../src/worker/db.ts";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

/** The statements of a migration file. The schema has no `;` inside literals. */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
}

/**
 * A fresh, in-memory local D1 (the same engine as `wrangler dev`) with every
 * migration applied. Call `dispose` when done.
 */
export async function localD1(): Promise<{ db: Db; reset: () => Promise<void>; dispose: () => Promise<void> }> {
  const proxy = await getPlatformProxy<{ DB: Db }>({ persist: false });
  const db = proxy.env.DB;
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(file, MIGRATIONS), "utf8");
    await db.batch(statements(sql).map((statement) => db.prepare(statement)));
  }
  const reset = async () => {
    await db.batch(
      ["upload_records", "accepted_versions", "items", "panels", "record_versions", "uploads"].map((table) =>
        db.prepare(`DELETE FROM ${table}`),
      ),
    );
  };
  return { db, reset, dispose: () => proxy.dispose() };
}
