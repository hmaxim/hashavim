import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AI_PROVIDER } from '../src/ai/ai-provider';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { RequestIdInterceptor } from '../src/common/request-id.interceptor';
import { AppConfig } from '../src/config/app-config';
import { SqliteDatabase } from '../src/ledger/database';
import { ControllableAiProvider, FakeClock } from './fakes';

export interface TestApp {
  app: INestApplication;
  clock: FakeClock;
  ai: ControllableAiProvider;
  config: AppConfig;
  dbPath: string;
  close: () => Promise<void>;
}

export async function createTestApp(
  overrides: Partial<AppConfig> = {},
): Promise<TestApp> {
  const dbPath = path.join(
    os.tmpdir(),
    `usage-meter-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  );
  const config: AppConfig = {
    port: 0,
    dbPath,
    defaultLimit: 5,
    period: 'daily',
    aiFailureRate: 0,
    aiMinDelayMs: 1,
    aiMaxDelayMs: 1,
    aiTimeoutMs: 2000,
    reservationTtlSeconds: 30,
    sweeperIntervalMs: 60_000,
    adminToken: ADMIN_TOKEN,
    ...overrides,
  };
  const clock = new FakeClock(new Date('2024-06-15T12:00:00.000Z'));
  const ai = new ControllableAiProvider();
  ai.succeed('test-ok');

  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.forRoot({
        config,
        clock,
        aiProvider: ai,
        enableSweeper: false,
      }),
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());
  await app.init();

  return {
    app,
    clock,
    ai,
    config,
    dbPath,
    close: async () => {
      const sqlite = app.get(SqliteDatabase);
      sqlite.close();
      await app.close();
      for (const suffix of ['', '-wal', '-shm']) {
        const p = dbPath + suffix;
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      }
    },
  };
}

export { AI_PROVIDER };

export const ADMIN_TOKEN = 'test-admin-token';

/** Test-only DB probes; kept out of LedgerRepository so production code cannot call them. */
export function injectCounterDrift(
  sqlite: SqliteDatabase,
  userId: string,
  periodId: string,
  delta: number,
): void {
  sqlite.db
    .prepare(
      `INSERT INTO quota_counters(user_id, period_id, used) VALUES (?, ?, 0)
       ON CONFLICT(user_id, period_id) DO NOTHING`,
    )
    .run(userId, periodId);
  sqlite.db
    .prepare('UPDATE quota_counters SET used = used + ? WHERE user_id = ? AND period_id = ?')
    .run(delta, userId, periodId);
}

export function firstUsageId(sqlite: SqliteDatabase, userId: string): string {
  const row = sqlite.db
    .prepare('SELECT usage_id FROM usage_ledger WHERE user_id = ? LIMIT 1')
    .get(userId) as { usage_id: string } | undefined;
  if (!row) {
    throw new Error(`no ledger row for ${userId}`);
  }
  return row.usage_id;
}

export function errorMessageOf(fn: () => unknown): string {
  try {
    fn();
    return 'no error';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
