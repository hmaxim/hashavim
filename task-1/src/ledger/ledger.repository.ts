import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { CLOCK, Clock } from '../common/clock';
import { periodBounds, periodIdFor } from '../common/period';
import { SqliteDatabase } from './database';
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  IdempotencyRecord,
  LedgerRow,
  ReconcileDrift,
  UsageSnapshot,
} from './types';

export interface ReserveInput {
  userId: string;
  idempotencyKey: string;
  requestId: string;
  requestHash: string;
}

export interface ReserveResult {
  kind: 'reserved' | 'replay' | 'rejected';
  reservationId: string;
  usage: UsageSnapshot;
  cachedResponse?: unknown;
}

export interface SettleInput {
  reservationId: string;
  userId: string;
  periodId: string;
  success: boolean;
  aiOutcome: string;
  latencyMs: number;
  errorCode: string | null;
  releaseReason: string | null;
  /** Builds the idempotency replay body; stored in the same transaction as the settle row. */
  buildResponse: (usage: UsageSnapshot) => unknown;
}

export interface SettleResult {
  usage: UsageSnapshot;
  /** False when the reservation was already terminal (e.g. released by TTL). */
  settled: boolean;
}

@Injectable()
export class LedgerRepository {
  constructor(
    private readonly sqlite: SqliteDatabase,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  getDb(): SqliteDatabase {
    return this.sqlite;
  }

  getEffectiveLimit(userId: string): number {
    const row = this.sqlite.db
      .prepare('SELECT limit_override FROM user_limits WHERE user_id = ?')
      .get(userId) as { limit_override: number } | undefined;
    return row?.limit_override ?? this.config.defaultLimit;
  }

  setUserLimit(userId: string, limit: number): void {
    this.sqlite.withImmediateTransaction(() => {
      this.sqlite.db
        .prepare(
          `INSERT INTO user_limits(user_id, limit_override) VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET limit_override = excluded.limit_override`,
        )
        .run(userId, limit);
    });
  }

  private ensureCounter(userId: string, periodId: string): void {
    this.sqlite.db
      .prepare(
        `INSERT INTO quota_counters(user_id, period_id, used) VALUES (?, ?, 0)
         ON CONFLICT(user_id, period_id) DO NOTHING`,
      )
      .run(userId, periodId);
  }

  private readCounter(userId: string, periodId: string): number {
    const row = this.sqlite.db
      .prepare(
        'SELECT used FROM quota_counters WHERE user_id = ? AND period_id = ?',
      )
      .get(userId, periodId) as { used: number } | undefined;
    return row?.used ?? 0;
  }

  private countPending(userId: string, periodId: string, nowIso: string): number {
    // RESERVED rows remain after settle (append-only); exclude those with a terminal row.
    const row = this.sqlite.db
      .prepare(
        `SELECT COUNT(*) AS c FROM usage_ledger r
         WHERE r.user_id = ? AND r.period_id = ? AND r.status = 'RESERVED'
           AND (r.expire_at IS NULL OR r.expire_at > ?)
           AND NOT EXISTS (
             SELECT 1 FROM usage_ledger t
             WHERE t.reservation_id = r.reservation_id
               AND t.status IN ('COMMITTED', 'RELEASED')
           )`,
      )
      .get(userId, periodId, nowIso) as { c: number };
    return row.c;
  }

  private countCommitted(userId: string, periodId: string): number {
    const row = this.sqlite.db
      .prepare(
        `SELECT COUNT(*) AS c FROM usage_ledger
         WHERE user_id = ? AND period_id = ? AND status = 'COMMITTED'`,
      )
      .get(userId, periodId) as { c: number };
    return row.c;
  }

  buildUsageSnapshot(userId: string, periodId?: string): UsageSnapshot {
    const now = this.clock.now();
    const pid = periodId ?? periodIdFor(now, this.config.period);
    const bounds = periodBounds(pid, this.config.period);
    const limit = this.getEffectiveLimit(userId);
    const nowIso = now.toISOString();
    const pending = this.countPending(userId, pid, nowIso);
    const committed = this.countCommitted(userId, pid);
    const used = committed;
    const remaining = Math.max(0, limit - used - pending);
    return {
      userId,
      periodId: pid,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      limit,
      used,
      pending,
      remaining,
    };
  }

  getRecentLedger(userId: string, limit = 20): LedgerRow[] {
    return this.sqlite.db
      .prepare(
        `SELECT * FROM usage_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(userId, limit) as LedgerRow[];
  }

  /**
   * Expire stale RESERVED rows for a user/period inside an open transaction.
   * Returns how many credits were returned to the counter.
   */
  expireStaleInTx(userId: string, periodId: string, nowIso: string): number {
    const stale = this.sqlite.db
      .prepare(
        `SELECT * FROM usage_ledger r
         WHERE r.user_id = ? AND r.period_id = ? AND r.status = 'RESERVED'
           AND r.expire_at IS NOT NULL AND r.expire_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM usage_ledger t
             WHERE t.reservation_id = r.reservation_id
               AND t.status IN ('COMMITTED', 'RELEASED')
           )`,
      )
      .all(userId, periodId, nowIso) as LedgerRow[];

    let released = 0;
    for (const row of stale) {
      // Skip if already settled (terminal unique index would fail anyway).
      const terminal = this.sqlite.db
        .prepare(
          `SELECT 1 AS ok FROM usage_ledger
           WHERE reservation_id = ? AND status IN ('COMMITTED','RELEASED') LIMIT 1`,
        )
        .get(row.reservation_id) as { ok: number } | undefined;
      if (terminal) {
        continue;
      }

      const usageId = randomUUID();
      try {
        this.sqlite.db
          .prepare(
            `INSERT INTO usage_ledger(
              usage_id, user_id, idempotency_key, request_id, period_id, status,
              reservation_id, credits, limit_at_time_of_use, created_at, settled_at,
              ai_outcome, latency_ms, error_code, request_hash, expire_at, release_reason
            ) VALUES (?, ?, ?, ?, ?, 'RELEASED', ?, 0, ?, ?, ?, NULL, NULL, 'TTL_EXPIRED', ?, NULL, 'ttl_expired')`,
          )
          .run(
            usageId,
            row.user_id,
            row.idempotency_key,
            row.request_id,
            row.period_id,
            row.reservation_id,
            row.limit_at_time_of_use,
            nowIso,
            nowIso,
            row.request_hash,
          );
        this.sqlite.db
          .prepare(
            `UPDATE quota_counters SET used = used - 1
             WHERE user_id = ? AND period_id = ? AND used > 0`,
          )
          .run(userId, periodId);
        this.sqlite.db
          .prepare(
            `UPDATE idempotency_index SET terminal = 1,
             response_json = COALESCE(response_json, ?)
             WHERE user_id = ? AND idempotency_key = ?`,
          )
          .run(
            JSON.stringify({
              status: 'released',
              reason: 'ttl_expired',
              reservationId: row.reservation_id,
            }),
            userId,
            row.idempotency_key,
          );
        released += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Race: another settler won the terminal unique index.
        if (message.includes('UNIQUE')) {
          continue;
        }
        throw err;
      }
    }
    return released;
  }

  /** Global sweeper: expire all stale reservations. */
  expireAllStale(): number {
    const nowIso = this.clock.now().toISOString();
    return this.sqlite.withImmediateTransaction(() => {
      const rows = this.sqlite.db
        .prepare(
          `SELECT DISTINCT r.user_id, r.period_id FROM usage_ledger r
           WHERE r.status = 'RESERVED' AND r.expire_at IS NOT NULL AND r.expire_at <= ?
             AND NOT EXISTS (
               SELECT 1 FROM usage_ledger t
               WHERE t.reservation_id = r.reservation_id
                 AND t.status IN ('COMMITTED', 'RELEASED')
             )`,
        )
        .all(nowIso) as Array<{ user_id: string; period_id: string }>;
      let total = 0;
      for (const r of rows) {
        total += this.expireStaleInTx(r.user_id, r.period_id, nowIso);
      }
      return total;
    });
  }

  reserve(input: ReserveInput): ReserveResult {
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const periodId = periodIdFor(now, this.config.period);

    return this.sqlite.withImmediateTransaction(() => {
      this.expireStaleInTx(input.userId, periodId, nowIso);
      this.ensureCounter(input.userId, periodId);

      const existing = this.sqlite.db
        .prepare(
          `SELECT * FROM idempotency_index
           WHERE user_id = ? AND idempotency_key = ?`,
        )
        .get(input.userId, input.idempotencyKey) as IdempotencyRecord | undefined;

      if (existing) {
        if (existing.request_hash !== input.requestHash) {
          throw new IdempotencyConflictError(
            'Idempotency-Key reused with a different payload',
          );
        }
        if (existing.terminal === 0 || !existing.response_json) {
          throw new IdempotencyInProgressError(
            'A request with this Idempotency-Key is still in progress',
          );
        }
        const usage = this.buildUsageSnapshot(input.userId, periodId);
        return {
          kind: 'replay' as const,
          reservationId: existing.reservation_id,
          usage,
          cachedResponse: JSON.parse(existing.response_json) as unknown,
        };
      }

      const limit = this.getEffectiveLimit(input.userId);
      const used = this.readCounter(input.userId, periodId);

      if (used >= limit) {
        const reservationId = randomUUID();
        const usageId = randomUUID();
        this.sqlite.db
          .prepare(
            `INSERT INTO usage_ledger(
              usage_id, user_id, idempotency_key, request_id, period_id, status,
              reservation_id, credits, limit_at_time_of_use, created_at, settled_at,
              ai_outcome, latency_ms, error_code, request_hash, expire_at, release_reason
            ) VALUES (?, ?, ?, ?, ?, 'REJECTED_QUOTA', ?, 0, ?, ?, NULL, NULL, NULL, 'QUOTA_EXCEEDED', ?, NULL, NULL)`,
          )
          .run(
            usageId,
            input.userId,
            input.idempotencyKey,
            input.requestId,
            periodId,
            reservationId,
            limit,
            nowIso,
            input.requestHash,
          );

        const rejectPayload = {
          status: 'rejected_quota',
          reservationId,
        };
        this.sqlite.db
          .prepare(
            `INSERT INTO idempotency_index(
              user_id, idempotency_key, reservation_id, request_hash, response_json, terminal
            ) VALUES (?, ?, ?, ?, ?, 1)`,
          )
          .run(
            input.userId,
            input.idempotencyKey,
            reservationId,
            input.requestHash,
            JSON.stringify(rejectPayload),
          );

        const usage = this.buildUsageSnapshot(input.userId, periodId);
        return {
          kind: 'rejected' as const,
          reservationId,
          usage,
        };
      }

      const reservationId = randomUUID();
      const usageId = randomUUID();
      const expireAt = new Date(
        now.getTime() + this.config.reservationTtlSeconds * 1000,
      ).toISOString();

      this.sqlite.db
        .prepare(
          `INSERT INTO usage_ledger(
            usage_id, user_id, idempotency_key, request_id, period_id, status,
            reservation_id, credits, limit_at_time_of_use, created_at, settled_at,
            ai_outcome, latency_ms, error_code, request_hash, expire_at, release_reason
          ) VALUES (?, ?, ?, ?, ?, 'RESERVED', ?, 1, ?, ?, NULL, NULL, NULL, NULL, ?, ?, NULL)`,
        )
        .run(
          usageId,
          input.userId,
          input.idempotencyKey,
          input.requestId,
          periodId,
          reservationId,
          limit,
          nowIso,
          input.requestHash,
          expireAt,
        );

      this.sqlite.db
        .prepare(
          `UPDATE quota_counters SET used = used + 1
           WHERE user_id = ? AND period_id = ?`,
        )
        .run(input.userId, periodId);

      this.sqlite.db
        .prepare(
          `INSERT INTO idempotency_index(
            user_id, idempotency_key, reservation_id, request_hash, response_json, terminal
          ) VALUES (?, ?, ?, ?, NULL, 0)`,
        )
        .run(
          input.userId,
          input.idempotencyKey,
          reservationId,
          input.requestHash,
        );

      const usage = this.buildUsageSnapshot(input.userId, periodId);
      return {
        kind: 'reserved' as const,
        reservationId,
        usage,
      };
    });
  }

  settle(input: SettleInput): SettleResult {
    const nowIso = this.clock.now().toISOString();

    return this.sqlite.withImmediateTransaction(() => {
      const reserveRow = this.sqlite.db
        .prepare(
          `SELECT * FROM usage_ledger
           WHERE reservation_id = ? AND status = 'RESERVED' LIMIT 1`,
        )
        .get(input.reservationId) as LedgerRow | undefined;

      const terminal = this.sqlite.db
        .prepare(
          `SELECT 1 AS ok FROM usage_ledger
           WHERE reservation_id = ? AND status IN ('COMMITTED','RELEASED') LIMIT 1`,
        )
        .get(input.reservationId) as { ok: number } | undefined;

      // Already settled (e.g. TTL release won the race): ignore the late completion.
      if (terminal || !reserveRow) {
        return {
          usage: this.buildUsageSnapshot(input.userId, input.periodId),
          settled: false,
        };
      }

      this.sqlite.db
        .prepare(
          `INSERT INTO usage_ledger(
            usage_id, user_id, idempotency_key, request_id, period_id, status,
            reservation_id, credits, limit_at_time_of_use, created_at, settled_at,
            ai_outcome, latency_ms, error_code, request_hash, expire_at, release_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(
          randomUUID(),
          reserveRow.user_id,
          reserveRow.idempotency_key,
          reserveRow.request_id,
          reserveRow.period_id,
          input.success ? 'COMMITTED' : 'RELEASED',
          input.reservationId,
          input.success ? 1 : 0,
          reserveRow.limit_at_time_of_use,
          nowIso,
          nowIso,
          input.aiOutcome,
          input.latencyMs,
          input.success ? null : input.errorCode,
          reserveRow.request_hash,
          input.success ? null : input.releaseReason,
        );

      // The counter already holds this credit from RESERVE; only a release gives it back.
      if (!input.success) {
        this.sqlite.db
          .prepare(
            `UPDATE quota_counters SET used = used - 1
             WHERE user_id = ? AND period_id = ? AND used > 0`,
          )
          .run(reserveRow.user_id, reserveRow.period_id);
      }

      const usage = this.buildUsageSnapshot(input.userId, reserveRow.period_id);
      this.sqlite.db
        .prepare(
          `UPDATE idempotency_index
           SET terminal = 1, response_json = ?
           WHERE user_id = ? AND idempotency_key = ?`,
        )
        .run(
          JSON.stringify(input.buildResponse(usage)),
          reserveRow.user_id,
          reserveRow.idempotency_key,
        );

      return { usage, settled: true };
    });
  }

  reconcile(now: Date = this.clock.now()): ReconcileDrift[] {
    const nowIso = now.toISOString();
    const counters = this.sqlite.db
      .prepare(`SELECT user_id, period_id, used FROM quota_counters`)
      .all() as Array<{ user_id: string; period_id: string; used: number }>;

    const drifts: ReconcileDrift[] = [];
    for (const c of counters) {
      const committed = this.countCommitted(c.user_id, c.period_id);
      const pending = this.countPending(c.user_id, c.period_id, nowIso);
      const ledgerUsed = committed + pending;
      if (ledgerUsed !== c.used) {
        drifts.push({
          userId: c.user_id,
          periodId: c.period_id,
          counterUsed: c.used,
          ledgerUsed,
        });
      }
    }
    return drifts;
  }
}
