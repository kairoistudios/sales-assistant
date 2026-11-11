import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { SCHEMA } from "./schema";

export type SqlValue = SQLInputValue;
export type Db = DatabaseSync;

let singleton: Db | null = null;

export function openDatabase(file = ":memory:"): Db {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

export function getDatabasePath(): string {
  return process.env.DATABASE_PATH || path.join(process.cwd(), "data", "sales-assistant.db");
}

export function getDb(): Db {
  if (!singleton) singleton = openDatabase(getDatabasePath());
  return singleton;
}

export function resetSingleton(): void {
  singleton?.close();
  singleton = null;
}

export function run(db: Db, sql: string, params: SqlValue[] = []): void {
  db.prepare(sql).run(...params);
}

export function one<T extends object>(db: Db, sql: string, params: SqlValue[] = []): T | undefined {
  const row = db.prepare(sql).get(...params) as T | undefined;
  return row ? ({ ...row } as T) : undefined;
}

export function many<T extends object>(db: Db, sql: string, params: SqlValue[] = []): T[] {
  return (db.prepare(sql).all(...params) as T[]).map((row) => ({ ...row }));
}

export function withTx(db: Db, fn: () => void): void {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
