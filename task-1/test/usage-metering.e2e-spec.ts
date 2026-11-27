import request, { Response } from 'supertest';
import { SqliteDatabase } from '../src/ledger/database';
import { LedgerRepository } from '../src/ledger/ledger.repository';
import { QuotaService } from '../src/quota/quota.service';
import {
  ADMIN_TOKEN,
  createTestApp,
  errorMessageOf,
  firstUsageId,
  injectCounterDrift,
  TestApp,
} from './helpers';

describe('Usage metering e2e', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp({ defaultLimit: 5 });
  });

  afterEach(async () => {
    await t.close();
  });

  it('enforces limit: (X+1)th request gets 429', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(t.app.getHttpServer())
        .post('/v1/ai/requests')
        .send({ userId: 'u1', prompt: `p${i}` })
        .expect(201);
      expect(res.body.status).toBe('committed');
    }
    const denied = await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .send({ userId: 'u1', prompt: 'overflow' })
      .expect(429);
    expect(denied.body.usage.remaining).toBe(0);
  });

  it('concurrency: limit=5 with 50 parallel requests yields exactly 5 committed', async () => {
    await t.close();
    t = await createTestApp({ defaultLimit: 5, aiMinDelayMs: 0, aiMaxDelayMs: 0 });
    t.ai.succeed('ok');

    const calls = Array.from({ length: 50 }, (_, i) =>
      request(t.app.getHttpServer())
        .post('/v1/ai/requests')
        .send({ userId: 'race', prompt: `p${i}` }),
    );
    const results = await Promise.all(calls);
    const committed = results.filter(
      (r: Response) => r.status === 201 && r.body.status === 'committed',
    );
    const rejected = results.filter((r: Response) => r.status === 429);
    expect(committed.length).toBe(5);
    expect(rejected.length).toBe(45);

    const usage = await request(t.app.getHttpServer())
      .get('/v1/users/race/usage')
      .expect(200);
    expect(usage.body.used).toBe(5);
    expect(usage.body.pending).toBe(0);
    expect(usage.body.remaining).toBe(0);

    const drifts = t.app.get(QuotaService).reconcile();
    expect(drifts).toEqual([]);
  });

  it('idempotency: replay returns same result without extra credit', async () => {
    const first = await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .set('Idempotency-Key', 'idem-1')
      .send({ userId: 'u2', prompt: 'hello' })
      .expect(201);

    const second = await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .set('Idempotency-Key', 'idem-1')
      .send({ userId: 'u2', prompt: 'hello' })
      .expect(201);

    expect(second.body.reservationId).toBe(first.body.reservationId);
    const usage = await request(t.app.getHttpServer())
      .get('/v1/users/u2/usage')
      .expect(200);
    expect(usage.body.used).toBe(1);
  });

  it('idempotency: same key different payload returns 409', async () => {
    await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .set('Idempotency-Key', 'idem-2')
      .send({ userId: 'u3', prompt: 'a' })
      .expect(201);

    await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .set('Idempotency-Key', 'idem-2')
      .send({ userId: 'u3', prompt: 'b' })
      .expect(409);
  });

  it('AI failure releases credit and keeps evidence', async () => {
    t.ai.fail('AI_SIMULATED_FAILURE');
    const res = await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .send({ userId: 'u4', prompt: 'fail-me' })
      .expect(201);
    expect(res.body.status).toBe('released');

    const usage = await request(t.app.getHttpServer())
      .get('/v1/users/u4/usage?includeRecent=true')
      .expect(200);
    expect(usage.body.used).toBe(0);
    expect(usage.body.remaining).toBe(5);
    expect(usage.body.recent.some((r: { status: string }) => r.status === 'RELEASED')).toBe(
      true,
    );
    expect(usage.body.recent.some((r: { status: string }) => r.status === 'RESERVED')).toBe(
      true,
    );
  });

  it('AI timeout releases; late settle does not double-charge', async () => {
    t.ai.timeout();
    const res = await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .send({ userId: 'u5', prompt: 'slow' })
      .expect(201);
    expect(res.body.status).toBe('released');
    expect(res.body.ai.timedOut).toBe(true);

    const ledger = t.app.get(LedgerRepository);
    const late = ledger.settle({
      reservationId: res.body.reservationId,
      userId: 'u5',
      periodId: res.body.usage.periodId,
      success: true,
      aiOutcome: 'success',
      latencyMs: 999,
      errorCode: null,
      releaseReason: null,
      buildResponse: () => ({ late: true }),
    });
    expect(late.settled).toBe(false);
    expect(late.usage.used).toBe(0);
    expect(late.usage.remaining).toBe(5);
  });

  it('stale RESERVED past TTL is expired and credit returned', async () => {
    await t.close();
    t = await createTestApp({
      defaultLimit: 2,
      reservationTtlSeconds: 10,
    });

    // Reserve without settling by calling ledger directly, then advance clock.
    const ledger = t.app.get(LedgerRepository);
    const reserved = ledger.reserve({
      userId: 'u6',
      idempotencyKey: 'stuck-1',
      requestId: 'req-stuck',
      requestHash: 'hash-stuck',
    });
    expect(reserved.kind).toBe('reserved');

    let usage = ledger.buildUsageSnapshot('u6');
    expect(usage.pending).toBe(1);
    expect(usage.remaining).toBe(1);

    t.clock.advanceMs(11_000);
    const released = ledger.expireAllStale();
    expect(released).toBe(1);

    usage = ledger.buildUsageSnapshot('u6');
    expect(usage.pending).toBe(0);
    expect(usage.used).toBe(0);
    expect(usage.remaining).toBe(2);
  });

  it('period rollover resets usage; old records retained', async () => {
    await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .send({ userId: 'u7', prompt: 'day1' })
      .expect(201);

    let usage = await request(t.app.getHttpServer())
      .get('/v1/users/u7/usage?includeRecent=true')
      .expect(200);
    const oldPeriod = usage.body.periodId;
    expect(usage.body.used).toBe(1);

    t.clock.set(new Date('2024-06-16T01:00:00.000Z'));
    usage = await request(t.app.getHttpServer())
      .get('/v1/users/u7/usage?includeRecent=true')
      .expect(200);
    expect(usage.body.periodId).not.toBe(oldPeriod);
    expect(usage.body.used).toBe(0);
    expect(usage.body.remaining).toBe(5);
    expect(usage.body.recent.length).toBeGreaterThan(0);
  });

  it('limit raise and lower mid-period; per-user override', async () => {
    await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .send({ userId: 'u8', prompt: 'a' })
      .expect(201);

    await request(t.app.getHttpServer())
      .put('/v1/users/u8/limit')
      .set('x-admin-token', ADMIN_TOKEN)
      .send({ limit: 1 })
      .expect(200);

    await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .send({ userId: 'u8', prompt: 'b' })
      .expect(429);

    await request(t.app.getHttpServer())
      .put('/v1/users/u8/limit')
      .set('x-admin-token', ADMIN_TOKEN)
      .send({ limit: 10 })
      .expect(200);

    await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .send({ userId: 'u8', prompt: 'c' })
      .expect(201);

    const usage = await request(t.app.getHttpServer())
      .get('/v1/users/u8/usage')
      .expect(200);
    expect(usage.body.limit).toBe(10);
    expect(usage.body.used).toBe(2);
  });

  it('usage endpoint shows pending while request in flight', async () => {
    t.ai.succeed('slow-ok');
    const entered = t.ai.block();
    const quota = t.app.get(QuotaService);

    const inFlight = quota.handleAiRequest(
      { userId: 'u9', prompt: 'inflight' },
      'idem-inflight',
      'req-inflight',
    );

    await entered;
    const mid = quota.getUsage('u9');
    expect(mid.pending).toBe(1);
    expect(mid.remaining).toBe(4);

    t.ai.release();
    const result = await inFlight;
    expect(result.status).toBe('committed');
    const after = quota.getUsage('u9');
    expect(after.pending).toBe(0);
    expect(after.used).toBe(1);
  });

  it('ledger immutability: UPDATE/DELETE fail', async () => {
    await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .send({ userId: 'u10', prompt: 'x' })
      .expect(201);
    const sqlite = t.app.get(SqliteDatabase);
    const id = firstUsageId(sqlite, 'u10');
    expect(
      errorMessageOf(() =>
        sqlite.db.prepare('UPDATE usage_ledger SET credits = 99 WHERE usage_id = ?').run(id),
      ),
    ).toMatch(/append-only/);
    expect(
      errorMessageOf(() =>
        sqlite.db.prepare('DELETE FROM usage_ledger WHERE usage_id = ?').run(id),
      ),
    ).toMatch(/append-only/);
  });

  it('reconcile detects injected counter drift', async () => {
    await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .send({ userId: 'u11', prompt: 'x' })
      .expect(201);
    const ledger = t.app.get(LedgerRepository);
    const usage = ledger.buildUsageSnapshot('u11');
    injectCounterDrift(t.app.get(SqliteDatabase), 'u11', usage.periodId, 3);
    const drifts = ledger.reconcile();
    expect(drifts.length).toBe(1);
    expect(drifts[0].counterUsed).toBe(usage.used + 3);
    expect(drifts[0].ledgerUsed).toBe(usage.used);
  });

  it('rejects invalid payloads', async () => {
    await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .send({ prompt: 'no-user' })
      .expect(400);

    await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .send({ userId: 'u12', prompt: '' })
      .expect(400);
  });

  it('limit=0 blocks all requests', async () => {
    await t.close();
    t = await createTestApp({ defaultLimit: 0 });
    await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .send({ userId: 'u0', prompt: 'nope' })
      .expect(429);
  });

  it('idempotency: same key while the first call is in flight returns 409, then replays', async () => {
    t.ai.succeed('ok');
    const entered = t.ai.block();
    const first = request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .set('Idempotency-Key', 'idem-inflight-dup')
      .send({ userId: 'u13', prompt: 'dup' })
      .then((r) => r);

    await entered;
    const dup = await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .set('Idempotency-Key', 'idem-inflight-dup')
      .send({ userId: 'u13', prompt: 'dup' })
      .expect(409);
    expect(dup.body.message).toMatch(/in progress/);

    t.ai.release();
    const done = await first;
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('committed');

    const replay = await request(t.app.getHttpServer())
      .post('/v1/ai/requests')
      .set('Idempotency-Key', 'idem-inflight-dup')
      .send({ userId: 'u13', prompt: 'dup' })
      .expect(201);
    expect(replay.body.status).toBe('committed');
    expect(replay.body.ai.text).toBe('ok');
    expect(replay.body.reservationId).toBe(done.body.reservationId);
    expect(t.ai.calls).toBe(1);
  });

  it('fails closed with 503 when the database is locked', async () => {
    const sqlite = t.app.get(SqliteDatabase);
    sqlite.db.pragma('busy_timeout = 50');
    const other = new SqliteDatabase(t.dbPath);
    other.db.exec('BEGIN EXCLUSIVE');
    try {
      await request(t.app.getHttpServer())
        .post('/v1/ai/requests')
        .send({ userId: 'u14', prompt: 'locked' })
        .expect(503);
      expect(t.ai.calls).toBe(0);
    } finally {
      other.db.exec('ROLLBACK');
      other.close();
    }
  });

  it('admin limit route requires the admin token', async () => {
    await request(t.app.getHttpServer())
      .put('/v1/users/u15/limit')
      .send({ limit: 1 })
      .expect(403);
    await request(t.app.getHttpServer())
      .put('/v1/users/u15/limit')
      .set('x-admin-token', 'wrong')
      .send({ limit: 1 })
      .expect(403);

    await t.close();
    t = await createTestApp({ adminToken: null });
    await request(t.app.getHttpServer())
      .put('/v1/users/u15/limit')
      .set('x-admin-token', ADMIN_TOKEN)
      .send({ limit: 1 })
      .expect(403);
  });
});
