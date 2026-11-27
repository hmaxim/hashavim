import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { SCHEMA_SQL } from './schema';
import { StorageUnavailableError } from './types';

export class SqliteDatabase {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(path.resolve(dbPath));
    fs.mkdirSync(dir, { recursive: true });
    try {
      this.db = new Database(dbPath);
      this.db.exec(SCHEMA_SQL);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new StorageUnavailableError(`Failed to open database: ${message}`);
    }
  }

  close(): void {
    this.db.close();
  }

  /** Run fn inside BEGIN IMMEDIATE. Must be synchronous (no await). */
  withImmediateTransaction<T>(fn: () => T): T {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      if (err instanceof StorageUnavailableError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('SQLITE_BUSY') ||
        message.includes('database is locked') ||
        message.includes('unable to open')
      ) {
        throw new StorageUnavailableError(message);
      }
      throw err;
    }
  }
}
