/**
 * Worker: open shared SQLite DB and race N reserve+commit cycles for one user.
 * Invoked as: ts-node test/multi-process.worker.ts <dbPath> <userId> <attempts> <limit>
 */
import { loadAppConfig } from '../src/config/app-config';
import { SystemClock } from '../src/common/clock';
import { SqliteDatabase } from '../src/ledger/database';
import { LedgerRepository } from '../src/ledger/ledger.repository';
import { ControllableAiProvider } from './fakes';
import { createHash, randomUUID } from 'crypto';

async function main(): Promise<void> {
  const [, , dbPath, userId, attemptsRaw] = process.argv;
  const attempts = Number(attemptsRaw);
  const config = {
    ...loadAppConfig({
      DB_PATH: dbPath,
      DEFAULT_LIMIT: process.env.DEFAULT_LIMIT ?? '5',
      AI_FAILURE_RATE: '0',
      AI_MIN_DELAY_MS: '0',
      AI_MAX_DELAY_MS: '0',
      AI_TIMEOUT_MS: '5000',
      RESERVATION_TTL_SECONDS: '60',
      PERIOD: 'daily',
    }),
  };
  const clock = new SystemClock();
  const sqlite = new SqliteDatabase(config.dbPath);
  const ledger = new LedgerRepository(sqlite, config, clock);
  const ai = new ControllableAiProvider();
  ai.succeed('ok');

  let committed = 0;
  let rejected = 0;

  for (let i = 0; i < attempts; i++) {
    const idem = randomUUID();
    const hash = createHash('sha256')
      .update(`${userId}:${i}:${process.pid}`)
      .digest('hex');
    try {
      const reserve = ledger.reserve({
        userId,
        idempotencyKey: idem,
        requestId: randomUUID(),
        requestHash: hash,
      });
      if (reserve.kind === 'rejected') {
        rejected += 1;
        continue;
      }
      if (reserve.kind === 'reserved') {
        const aiResult = await ai.complete('x');
        ledger.settle({
          reservationId: reserve.reservationId,
          userId,
          periodId: reserve.usage.periodId,
          success: aiResult.ok,
          aiOutcome: 'success',
          latencyMs: 1,
          errorCode: null,
          releaseReason: null,
          buildResponse: () => ({ ok: true }),
        });
        committed += 1;
      }
    } catch {
      rejected += 1;
    }
  }

  sqlite.close();
  process.stdout.write(JSON.stringify({ pid: process.pid, committed, rejected }));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
