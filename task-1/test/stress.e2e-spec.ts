import request, { Response } from 'supertest';
import { QuotaService } from '../src/quota/quota.service';
import { createTestApp, TestApp } from './helpers';

/**
 * Heavier load than the basic concurrency check.
 * Run alone: npm run test:stress
 * Kept out of the default `npm test` suite via the `stress` Jest project.
 */
describe('stress', () => {
  let t: TestApp;

  afterEach(async () => {
    if (t) {
      await t.close();
    }
  });

  it('bursts 500 parallel requests against limit=50 → exactly 50 committed, ledger agrees', async () => {
    const limit = 50;
    const burst = 500;
    t = await createTestApp({
      defaultLimit: limit,
      aiMinDelayMs: 0,
      aiMaxDelayMs: 0,
    });
    t.ai.succeed('ok');

    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: burst }, (_, i) =>
        request(t.app.getHttpServer())
          .post('/v1/ai/requests')
          .send({ userId: 'stress-burst', prompt: `p${i}` }),
      ),
    );
    const elapsedMs = Date.now() - started;

    const committed = results.filter(
      (r: Response) => r.status === 201 && r.body.status === 'committed',
    );
    const rejected = results.filter((r: Response) => r.status === 429);
    expect(committed.length).toBe(limit);
    expect(rejected.length).toBe(burst - limit);
    expect(results.every((r: Response) => r.status === 201 || r.status === 429)).toBe(
      true,
    );

    const usage = await request(t.app.getHttpServer())
      .get('/v1/users/stress-burst/usage')
      .expect(200);
    expect(usage.body.used).toBe(limit);
    expect(usage.body.pending).toBe(0);
    expect(usage.body.remaining).toBe(0);
    expect(t.app.get(QuotaService).reconcile()).toEqual([]);

    // Soft latency budget for a laptop; fails only if something is pathologically slow.
    expect(elapsedMs).toBeLessThan(60_000);
  }, 90_000);

  it('sustains 20 waves of 100 mixed POST+GET across 10 users without drift', async () => {
    const users = Array.from({ length: 10 }, (_, i) => `u${i}`);
    const perUserLimit = 80;
    t = await createTestApp({
      defaultLimit: perUserLimit,
      aiMinDelayMs: 0,
      aiMaxDelayMs: 0,
    });
    t.ai.succeed('ok');

    const waves = 20;
    const perWave = 100;
    let postOk = 0;
    let post429 = 0;
    let getOk = 0;

    for (let w = 0; w < waves; w++) {
      const batch = await Promise.all(
        Array.from({ length: perWave }, (_, i) => {
          const userId = users[(w * perWave + i) % users.length];
          if (i % 4 === 0) {
            return request(t.app.getHttpServer())
              .get(`/v1/users/${userId}/usage`)
              .then((r: Response) => {
                expect(r.status).toBe(200);
                getOk += 1;
                return r;
              });
          }
          return request(t.app.getHttpServer())
            .post('/v1/ai/requests')
            .send({ userId, prompt: `w${w}-${i}` })
            .then((r: Response) => {
              expect([201, 429]).toContain(r.status);
              if (r.status === 201) postOk += 1;
              if (r.status === 429) post429 += 1;
              return r;
            });
        }),
      );
      expect(batch.length).toBe(perWave);
    }

    expect(getOk).toBeGreaterThan(0);
    expect(postOk).toBeGreaterThan(0);
    expect(postOk + post429).toBe(waves * perWave - getOk);

    for (const userId of users) {
      const usage = await request(t.app.getHttpServer())
        .get(`/v1/users/${userId}/usage`)
        .expect(200);
      expect(usage.body.used).toBeLessThanOrEqual(perUserLimit);
      expect(usage.body.pending).toBe(0);
      expect(usage.body.used + usage.body.remaining).toBe(perUserLimit);
    }
    expect(t.app.get(QuotaService).reconcile()).toEqual([]);
  }, 120_000);

  it('idempotent stress: 200 parallel retries of 20 keys never double-charge', async () => {
    const keys = 20;
    const retriesPerKey = 10;
    t = await createTestApp({
      defaultLimit: 100,
      aiMinDelayMs: 0,
      aiMaxDelayMs: 0,
    });
    t.ai.succeed('idem-ok');

    const calls = Array.from({ length: keys * retriesPerKey }, (_, i) => {
      const key = `idem-${i % keys}`;
      return request(t.app.getHttpServer())
        .post('/v1/ai/requests')
        .set('Idempotency-Key', key)
        .send({ userId: 'idem-stress', prompt: `same-${i % keys}` });
    });

    const results = await Promise.all(calls);
    const byKey = new Map<string, Response[]>();
    for (let i = 0; i < results.length; i++) {
      const key = `idem-${i % keys}`;
      const list = byKey.get(key) ?? [];
      list.push(results[i]);
      byKey.set(key, list);
    }

    for (const [, responses] of byKey) {
      const successes = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);
      // One winner commits (or all get the same replay after the first settles).
      // In-flight duplicates may briefly 409; after settle, replays are 201.
      expect(successes.length + conflicts.length).toBe(responses.length);
      expect(successes.length).toBeGreaterThanOrEqual(1);
      const reservationIds = new Set(
        successes.map((r) => r.body.reservationId as string),
      );
      expect(reservationIds.size).toBe(1);
    }

    const usage = await request(t.app.getHttpServer())
      .get('/v1/users/idem-stress/usage')
      .expect(200);
    expect(usage.body.used).toBe(keys);
    expect(usage.body.pending).toBe(0);
    expect(t.app.get(QuotaService).reconcile()).toEqual([]);
    // Controllable AI should run once per unique key (not once per parallel retry).
    expect(t.ai.calls).toBe(keys);
  }, 90_000);

  it('many users racing their own last credit: each gets exactly one commit', async () => {
    const userCount = 100;
    t = await createTestApp({
      defaultLimit: 1,
      aiMinDelayMs: 0,
      aiMaxDelayMs: 0,
    });
    t.ai.succeed('last');

    const results = await Promise.all(
      Array.from({ length: userCount * 5 }, (_, i) => {
        const userId = `last-${i % userCount}`;
        return request(t.app.getHttpServer())
          .post('/v1/ai/requests')
          .send({ userId, prompt: `x${i}` });
      }),
    );

    const commitsByUser = new Map<string, number>();
    for (let i = 0; i < results.length; i++) {
      const userId = `last-${i % userCount}`;
      if (results[i].status === 201 && results[i].body.status === 'committed') {
        commitsByUser.set(userId, (commitsByUser.get(userId) ?? 0) + 1);
      }
    }

    expect(commitsByUser.size).toBe(userCount);
    for (const [, n] of commitsByUser) {
      expect(n).toBe(1);
    }

    for (let u = 0; u < userCount; u++) {
      const usage = await request(t.app.getHttpServer())
        .get(`/v1/users/last-${u}/usage`)
        .expect(200);
      expect(usage.body.used).toBe(1);
      expect(usage.body.remaining).toBe(0);
    }
    expect(t.app.get(QuotaService).reconcile()).toEqual([]);
  }, 90_000);
});
