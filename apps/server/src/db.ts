import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ReportDockConfig } from "./config.js";

export interface ReportRecord {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
  sizeBytes: number;
  assetCount: number;
  metadata: Record<string, unknown>;
  entryPath: string;
}

interface ReportRow {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  size_bytes: number;
  asset_count: number;
  metadata_json: string;
  entry_path: string;
}

export interface InsertReportInput {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
  assetCount: number;
  metadata: Record<string, unknown>;
  entryPath: string;
}

export interface UpdateReportInput {
  id: string;
  title?: string;
  updatedAt: string;
  version: number;
  sizeBytes: number;
  assetCount: number;
  metadata: Record<string, unknown>;
  entryPath: string;
}

export interface ReportPage {
  reports: ReportRecord[];
  nextCursor?: string;
}

export class ReportDatabase {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static async open(config: ReportDockConfig): Promise<ReportDatabase> {
    await mkdir(path.dirname(config.databasePath), { recursive: true });
    const db = new DatabaseSync(config.databasePath);
    const database = new ReportDatabase(db);
    database.migrate();
    return database;
  }

  close(): void {
    this.db.close();
  }

  insertReport(input: InsertReportInput): void {
    this.db
      .prepare(
        `INSERT INTO reports (
          id, title, created_at, updated_at, deleted_at, version, size_bytes, asset_count, metadata_json, entry_path
        ) VALUES (?, ?, ?, ?, NULL, 1, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.title ?? null,
        input.createdAt,
        input.updatedAt,
        input.sizeBytes,
        input.assetCount,
        JSON.stringify(input.metadata),
        input.entryPath
      );
  }

  updateReport(input: UpdateReportInput): ReportRecord | undefined {
    this.db
      .prepare(
        `UPDATE reports
         SET title = ?,
             updated_at = ?,
             version = ?,
             size_bytes = ?,
             asset_count = ?,
             metadata_json = ?,
             entry_path = ?
         WHERE id = ? AND deleted_at IS NULL`
      )
      .run(
        input.title ?? null,
        input.updatedAt,
        input.version,
        input.sizeBytes,
        input.assetCount,
        JSON.stringify(input.metadata),
        input.entryPath,
        input.id
      );

    return this.getActiveReport(input.id);
  }

  getReport(id: string): ReportRecord | undefined {
    const row = this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as ReportRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  getActiveReport(id: string): ReportRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM reports WHERE id = ? AND deleted_at IS NULL")
      .get(id) as ReportRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  listReports(limit: number, cursor?: string): ReportPage {
    const normalizedLimit = Math.max(1, Math.min(limit, 100));
    const cursorValue = cursor ? decodeCursor(cursor) : undefined;
    const rows = cursorValue
      ? (this.db
          .prepare(
            `SELECT * FROM reports
             WHERE deleted_at IS NULL
             AND (created_at < ? OR (created_at = ? AND id < ?))
             ORDER BY created_at DESC, id DESC
             LIMIT ?`
          )
          .all(cursorValue.createdAt, cursorValue.createdAt, cursorValue.id, normalizedLimit + 1) as unknown as ReportRow[])
      : (this.db
          .prepare(
            `SELECT * FROM reports
             WHERE deleted_at IS NULL
             ORDER BY created_at DESC, id DESC
             LIMIT ?`
          )
          .all(normalizedLimit + 1) as unknown as ReportRow[]);

    const visibleRows = rows.slice(0, normalizedLimit);
    const reports = visibleRows.map(mapRow);
    const overflow = rows.at(normalizedLimit);

    return {
      reports,
      nextCursor: overflow ? encodeCursor(overflow.created_at, overflow.id) : undefined
    };
  }

  markDeleted(id: string, deletedAt: string): ReportRecord | undefined {
    const existing = this.getReport(id);
    if (!existing) {
      return undefined;
    }

    if (!existing.deletedAt) {
      this.db
        .prepare("UPDATE reports SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
        .run(deletedAt, id);
    }

    return this.getReport(id);
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        deleted_at TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        asset_count INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        entry_path TEXT NOT NULL DEFAULT 'index.html'
      );

      CREATE INDEX IF NOT EXISTS reports_created_at_idx ON reports(created_at DESC);
    `);
    this.ensureColumn("updated_at", "ALTER TABLE reports ADD COLUMN updated_at TEXT");
    this.ensureColumn("version", "ALTER TABLE reports ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
    this.db.exec(`
      UPDATE reports SET updated_at = created_at WHERE updated_at IS NULL;
      UPDATE reports SET version = 1 WHERE version IS NULL OR version < 1;
    `);
  }

  private ensureColumn(column: string, statement: string): void {
    const rows = this.db.prepare("PRAGMA table_info(reports)").all() as Array<{ name: string }>;
    if (!rows.some((row) => row.name === column)) {
      this.db.exec(statement);
    }
  }
}

function mapRow(row: ReportRow): ReportRecord {
  return {
    id: row.id,
    title: row.title ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    version: row.version,
    sizeBytes: row.size_bytes,
    assetCount: row.asset_count,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    entryPath: row.entry_path
  };
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id]), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { createdAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // Fall through to the shared validation error.
  }

  throw new Error("Invalid pagination cursor.");
}
