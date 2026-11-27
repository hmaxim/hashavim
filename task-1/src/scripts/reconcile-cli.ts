import * as fs from 'fs';
import { loadAppConfig } from '../config/app-config';
import { SystemClock } from '../common/clock';
import { SqliteDatabase } from '../ledger/database';
import { LedgerRepository } from '../ledger/ledger.repository';

function main(): void {
  const config = loadAppConfig();
  // Opening a missing path would create an empty DB and report "ok" on nothing.
  if (!fs.existsSync(config.dbPath)) {
    console.error(JSON.stringify({ ok: false, error: `database not found: ${config.dbPath}` }));
    process.exit(2);
  }
  const clock = new SystemClock();
  const sqlite = new SqliteDatabase(config.dbPath);
  const ledger = new LedgerRepository(sqlite, config, clock);
  const drifts = ledger.reconcile();
  if (drifts.length === 0) {
    console.log(JSON.stringify({ ok: true, drifts: [] }));
    sqlite.close();
    process.exit(0);
  }
  console.log(JSON.stringify({ ok: false, drifts }, null, 2));
  sqlite.close();
  process.exit(1);
}

main();
