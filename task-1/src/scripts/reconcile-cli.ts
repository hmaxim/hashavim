import { loadAppConfig } from '../config/app-config';
import { SystemClock } from '../common/clock';
import { SqliteDatabase } from '../ledger/database';
import { LedgerRepository } from '../ledger/ledger.repository';

function main(): void {
  const config = loadAppConfig();
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
