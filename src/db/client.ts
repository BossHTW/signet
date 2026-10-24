import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DATABASE_PATH ?? "./data/signet.db";

declare global {
  // eslint-disable-next-line no-var
  var __signetDb: ReturnType<typeof makeDb> | undefined;
}

function makeDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = DELETE");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

// Single connection per process (Next dev hot-reload safe)
export const db = globalThis.__signetDb ?? makeDb();
if (process.env.NODE_ENV !== "production") globalThis.__signetDb = db;
export { schema };
