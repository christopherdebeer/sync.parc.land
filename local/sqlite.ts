/**
 * Local SQLite adapter — drop-in replacement for Val Town's `https://esm.town/v/std/sqlite`.
 *
 * Uses deno.land/x/sqlite (WASM-based, zero native compilation) to match the
 * Val Town API shape:
 *   sqlite.execute({ sql, args }) → { rows: any[][], columns: string[] }
 *   sqlite.batch(stmts)           → void
 *
 * Database file defaults to `local/sync.db` (override with SYNC_DB_PATH env var).
 */
import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

const defaultDbPath = new URL("./sync.db", import.meta.url).pathname;
const DB_PATH = Deno.env.get("SYNC_DB_PATH") ?? defaultDbPath;

const db = new DB(DB_PATH);
db.query("PRAGMA journal_mode = WAL");
db.query("PRAGMA foreign_keys = ON");

export const sqlite = {
  async execute(
    stmt: { sql: string; args?: any[] },
  ): Promise<{ rows: any[][]; columns: string[] }> {
    const args = stmt.args ?? [];
    const prepared = db.prepareQuery(stmt.sql);
    const cols = prepared.columns();

    if (cols.length > 0) {
      const columns = cols.map((c) => c.name);
      const rows = prepared.all(args) as any[][];
      prepared.finalize();
      return { rows, columns };
    }

    prepared.execute(args);
    prepared.finalize();
    return { rows: [], columns: [] };
  },

  async batch(
    stmts: { sql: string; args?: any[] }[],
  ): Promise<void> {
    db.query("BEGIN TRANSACTION");
    try {
      for (const stmt of stmts) {
        db.query(stmt.sql, stmt.args ?? []);
      }
      db.query("COMMIT");
    } catch (e) {
      db.query("ROLLBACK");
      throw e;
    }
  },
};
