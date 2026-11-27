import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { AI_PROVIDER, AiProvider } from '../ai/ai-provider';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { periodIdFor } from '../common/period';
import { CLOCK, Clock } from '../common/clock';
import { LedgerRepository } from '../ledger/ledger.repository';
import {
  IdempotencyConflictError,
  StorageUnavailableError,
  UsageSnapshot,
} from '../ledger/types';

export interface AiRequestBody {
  userId: string;
  prompt: string;
}

export interface AiRequestResult {
  reservationId: string;
  status: 'committed' | 'released' | 'rejected_quota' | 'replay';
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
    const key = idempotencyKey && idempotencyKey.trim() !== '' ? idempotencyKey : uuidv4();
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
      if (err instanceof IdempotencyConflictError) {
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
      const cached = reserve.cachedResponse as AiRequestResult | undefined;
      if (cached && cached.status === 'rejected_quota') {
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
      if (cached) {
        return { ...cached, usage: reserve.usage, requestId };
      }
      return {
        reservationId: reserve.reservationId,
        status: 'replay',
        usage: reserve.usage,
        idempotencyKey: key,
        requestId,
      };
    }

    const periodId = periodIdFor(this.clock.now(), this.config.period);

    let aiResult;
    try {
      aiResult = await this.ai.complete(body.prompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      aiResult = {
        ok: false,
        errorCode: 'AI_PROVIDER_ERROR',
        latencyMs: 0,
        timedOut: false,
        text: undefined,
      };
      void message;
    }

    const success = aiResult.ok && !aiResult.timedOut;
    const releaseReason = success
      ? null
      : aiResult.timedOut
        ? 'ai_timeout'
        : 'ai_failure';

    try {
      const usage = this.ledger.settle({
        reservationId: reserve.reservationId,
        userId: body.userId,
        periodId,
        success,
        aiOutcome: success ? 'success' : aiResult.timedOut ? 'timeout' : 'failure',
        latencyMs: aiResult.latencyMs,
        errorCode: aiResult.errorCode ?? null,
        releaseReason,
        responsePayload: null,
      });

      const payload: AiRequestResult = {
        reservationId: reserve.reservationId,
        status: success ? 'committed' : 'released',
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
      };
      this.ledger.updateCachedResponse(body.userId, key, payload);
      return payload;
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
