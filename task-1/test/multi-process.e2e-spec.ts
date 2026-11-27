import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadAppConfig } from '../src/config/app-config';
import { SystemClock } from '../src/common/clock';
import { SqliteDatabase } from '../src/ledger/database';
import { LedgerRepository } from '../src/ledger/ledger.repository';

function runWorker(
  dbPath: string,
  userId: string,
  attempts: number,
  limit: number,
): Promise<{ committed: number; rejected: number }> {
  return new Promise((resolve, reject) => {
    const worker = path.join(__dirname, 'multi-process.worker.ts');
    const child = spawn(
      process.execPath,
      ['-r', 'ts-node/register', worker, dbPath, userId, String(attempts)],
      {
        env: {
          ...process.env,
          DEFAULT_LIMIT: String(limit),
          DB_PATH: dbPath,
          AI_FAILURE_RATE: '0',
        },
        cwd: path.join(__dirname, '..'),
      },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`worker exited ${code}: ${err || out}`));
        return;
      }
      try {
        resolve(JSON.parse(out) as { committed: number; rejected: number });
      } catch (e) {
        reject(new Error(`bad worker output: ${out} / ${err}`));
      }
    });
  });
}

describe('multi-process SQLite atomicity', () => {
  it('exactly limit commits across 3 processes on shared DB', async () => {
    const dbPath = path.join(
      os.tmpdir(),
      `mp-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    const limit = 5;
    const userId = 'shared-user';

    // Initialize schema once.
    const boot = new SqliteDatabase(dbPath);
    boot.close();

    const results = await Promise.all([
      runWorker(dbPath, userId, 20, limit),
      runWorker(dbPath, userId, 20, limit),
      runWorker(dbPath, userId, 20, limit),
    ]);

    const totalCommitted = results.reduce((s, r) => s + r.committed, 0);
    expect(totalCommitted).toBe(limit);

    const config = loadAppConfig({
      DB_PATH: dbPath,
      DEFAULT_LIMIT: String(limit),
      AI_FAILURE_RATE: '0',
    });
    const sqlite = new SqliteDatabase(dbPath);
    const ledger = new LedgerRepository(sqlite, config, new SystemClock());
    const usage = ledger.buildUsageSnapshot(userId);
    expect(usage.used).toBe(limit);
    expect(usage.pending).toBe(0);
    expect(ledger.reconcile()).toEqual([]);
    sqlite.close();

    for (const suffix of ['', '-wal', '-shm']) {
      const p = dbPath + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }, 120_000);
});
