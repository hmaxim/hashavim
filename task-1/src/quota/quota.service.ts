import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { AI_PROVIDER, AiProvider, AiResult } from '../ai/ai-provider';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { periodIdFor } from '../common/period';
import { CLOCK, Clock } from '../common/clock';
import { LedgerRepository } from '../ledger/ledger.repository';
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  StorageUnavailableError,
  UsageSnapshot,
} from '../ledger/types';

export interface AiRequestBody {
  userId: string;
  prompt: string;
}

export interface AiRequestResult {
  reservationId: string;
  status: 'committed' | 'released' | 'rejected_quota';
  ai?: {
    ok: boolean;
    text?: string;
    errorCode?: string;
    timedOut?: boolean;
    latencyMs?: number;
  };
  usage: UsageSnapshot;
  idempotencyKey: string;
  requestId: string;
}

@Injectable()
export class QuotaService {
  constructor(
    private readonly ledger: LedgerRepository,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private hashPayload(userId: string, prompt: string): string {
    return createHash('sha256')
      .update(JSON.stringify({ userId, prompt }))
      .digest('hex');
  }

  async handleAiRequest(
    body: AiRequestBody,
    idempotencyKey: string | undefined,
    requestId: string,
  ): Promise<AiRequestResult> {
    const key = idempotencyKey && idempotencyKey.trim() !== '' ? idempotencyKey : randomUUID();
    const requestHash = this.hashPayload(body.userId, body.prompt);

    let reserve;
    try {
      reserve = this.ledger.reserve({
        userId: body.userId,
        idempotencyKey: key,
        requestId,
        requestHash,
      });
    } catch (err) {
      if (
        err instanceof IdempotencyConflictError ||
        err instanceof IdempotencyInProgressError
      ) {
        throw new ConflictException(err.message);
      }
      if (err instanceof StorageUnavailableError) {
        throw new ServiceUnavailableException('Storage unavailable');
      }
      throw err;
    }

    if (reserve.kind === 'rejected') {
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Quota exceeded',
          usage: reserve.usage,
          idempotencyKey: key,
          requestId,
        },
        429,
      );
    }

    if (reserve.kind === 'replay') {
      const cached = reserve.cachedResponse as AiRequestResult;
      if (cached.status === 'rejected_quota') {
        throw new HttpException(
          {
            statusCode: 429,
            message: 'Quota exceeded',
            usage: reserve.usage,
            idempotencyKey: key,
            requestId,
          },
          429,
        );
      }
      return { ...cached, usage: reserve.usage, requestId };
    }

    const periodId = periodIdFor(this.clock.now(), this.config.period);

    let aiResult: AiResult;
    try {
      aiResult = await this.ai.complete(body.prompt);
    } catch {
      aiResult = { ok: false, errorCode: 'AI_PROVIDER_ERROR', latencyMs: 0, timedOut: false };
    }

    const success = aiResult.ok && !aiResult.timedOut;
    const releaseReason = success
      ? null
      : aiResult.timedOut
        ? 'ai_timeout'
        : 'ai_failure';

    const buildPayload = (usage: UsageSnapshot, settled: boolean): AiRequestResult => ({
      reservationId: reserve.reservationId,
      // If the TTL sweeper released the reservation first, the call is not billed.
      status: success && settled ? 'committed' : 'released',
      ai: {
        ok: success,
        text: aiResult.text,
        errorCode: aiResult.errorCode,
        timedOut: aiResult.timedOut,
        latencyMs: aiResult.latencyMs,
      },
      usage,
      idempotencyKey: key,
      requestId,
    });

    try {
      const result = this.ledger.settle({
        reservationId: reserve.reservationId,
        userId: body.userId,
        periodId,
        success,
        aiOutcome: success ? 'success' : aiResult.timedOut ? 'timeout' : 'failure',
        latencyMs: aiResult.latencyMs,
        errorCode: aiResult.errorCode ?? null,
        releaseReason,
        buildResponse: (usage) => buildPayload(usage, true),
      });
      return buildPayload(result.usage, result.settled);
    } catch (err) {
      if (err instanceof StorageUnavailableError) {
        throw new ServiceUnavailableException('Storage unavailable');
      }
      throw err;
    }
  }

  getUsage(userId: string, includeRecent = false): UsageSnapshot {
    try {
      // Lazy expiry before reporting.
      const periodId = periodIdFor(this.clock.now(), this.config.period);
      this.ledger.getDb().withImmediateTransaction(() => {
        this.ledger.expireStaleInTx(
          userId,
          periodId,
          this.clock.now().toISOString(),
        );
      });
      const usage = this.ledger.buildUsageSnapshot(userId);
      if (includeRecent) {
        usage.recent = this.ledger.getRecentLedger(userId, 20);
      }
      return usage;
    } catch (err) {
      if (err instanceof StorageUnavailableError) {
        throw new ServiceUnavailableException('Storage unavailable');
      }
      throw err;
    }
  }

  setUserLimit(userId: string, limit: number): UsageSnapshot {
    this.ledger.setUserLimit(userId, limit);
    return this.getUsage(userId);
  }

  sweep(): number {
    return this.ledger.expireAllStale();
  }

  reconcile() {
    return this.ledger.reconcile();
  }
}
