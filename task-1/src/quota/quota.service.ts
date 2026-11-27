import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { AI_PROVIDER, AiProvider, AiResult } from '../ai/ai-provider';
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
  /** Set on TTL-released replays: `ttl_expired`. */
  reason?: string;
  /** Null when the AI answer was never stored (reservation released by TTL). */
  ai?: {
    ok: boolean;
    text?: string;
    errorCode?: string;
    timedOut?: boolean;
    latencyMs?: number;
  } | null;
  usage: UsageSnapshot;
  idempotencyKey: string;
  requestId: string;
}

@Injectable()
export class QuotaService {
  constructor(
    private readonly ledger: LedgerRepository,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
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
        periodId: reserve.usage.periodId,
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
      this.ledger.expireStale(userId);
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
    try {
      this.ledger.setUserLimit(userId, limit);
    } catch (err) {
      if (err instanceof StorageUnavailableError) {
        throw new ServiceUnavailableException('Storage unavailable');
      }
      throw err;
    }
    return this.getUsage(userId);
  }

  sweep(): number {
    return this.ledger.expireAllStale();
  }

  reconcile() {
    return this.ledger.reconcile();
  }
}
