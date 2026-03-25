import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const MIGRATION_FILES = [
  new URL(
    "../../../../../packages/db/migrations/0000_far_gargoyle.sql",
    import.meta.url,
  ),
  new URL(
    "../../../../../packages/db/migrations/0001_aromatic_night_thrasher.sql",
    import.meta.url,
  ),
  new URL(
    "../../../../../packages/db/migrations/0002_lazy_dragon_lord.sql",
    import.meta.url,
  ),
  new URL(
    "../../../../../packages/db/migrations/0003_absurd_jean_grey.sql",
    import.meta.url,
  ),
];

type SqliteRunResult = {
  changes?: number | bigint;
  lastInsertRowid?: number | bigint;
};

function normalizeRow<T>(row: T): T {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return row;
  }
  return { ...(row as Record<string, unknown>) } as T;
}

function coerceNumber(value: number | bigint | undefined): number {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : 0;
}

class BoundStatement {
  readonly __sql: string;
  readonly __params: unknown[];

  constructor(
    private readonly db: DatabaseSync,
    sql: string,
    params: unknown[],
  ) {
    this.__sql = sql;
    this.__params = params;
  }

  bind(...params: unknown[]) {
    return new BoundStatement(this.db, this.__sql, params);
  }

  async first<T>(): Promise<T | null> {
    const stmt = this.db.prepare(this.__sql);
    const row = stmt.get(...this.__params);
    return row ? normalizeRow(row as T) : null;
  }

  async all<T>(): Promise<{
    results: T[];
    success: true;
    meta: { changes: 0 };
  }> {
    const stmt = this.db.prepare(this.__sql);
    const rows = stmt
      .all(...this.__params)
      .map((row: unknown) => normalizeRow(row)) as T[];
    return {
      results: rows,
      success: true,
      meta: { changes: 0 },
    };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const stmt = this.db.prepare(this.__sql);
    stmt.setReturnArrays(true);
    return stmt.all(...this.__params) as T[];
  }

  async run(): Promise<{
    success: true;
    meta: { changes: number; last_row_id: number };
  }> {
    const stmt = this.db.prepare(this.__sql);
    const result = stmt.run(...this.__params) as SqliteRunResult;
    return {
      success: true,
      meta: {
        changes: coerceNumber(result.changes),
        last_row_id: coerceNumber(result.lastInsertRowid),
      },
    };
  }

  async __executeForBatch() {
    const keyword = this.__sql.trimStart().split(/\s+/, 1)[0]?.toLowerCase();
    if (
      keyword === "select" ||
      keyword === "with" ||
      keyword === "pragma" ||
      keyword === "explain"
    ) {
      return this.all();
    }

    return this.run();
  }
}

export class SqliteD1Database {
  private readonly db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON;");
    applyMigrations(this);
  }

  prepare(sql: string) {
    return new BoundStatement(this.db, sql, []);
  }

  async batch(statements: Array<BoundStatement>) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.__executeForBatch());
    }
    return results;
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  close() {
    this.db.close();
  }
}

function applyMigrations(db: SqliteD1Database) {
  for (const file of MIGRATION_FILES) {
    const content = readFileSync(file, "utf8");
    const statements = content
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      db.exec(statement);
    }
  }
}

export function createSqliteD1Database(): D1Database & {
  close: () => void;
} {
  return new SqliteD1Database() as unknown as D1Database & {
    close: () => void;
  };
}
