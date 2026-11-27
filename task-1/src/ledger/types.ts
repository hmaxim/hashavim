export type LedgerStatus =
  | 'RESERVED'
  | 'COMMITTED'
  | 'RELEASED'
  | 'REJECTED_QUOTA';

export interface LedgerRow {
  usage_id: string;
  user_id: string;
  idempotency_key: string;
  request_id: string;
  period_id: string;
  status: LedgerStatus;
  reservation_id: string;
  credits: number;
  limit_at_time_of_use: number;
  created_at: string;
  settled_at: string | null;
  ai_outcome: string | null;
  latency_ms: number | null;
  error_code: string | null;
  request_hash: string | null;
  expire_at: string | null;
  release_reason: string | null;
}

export interface IdempotencyRecord {
  user_id: string;
  idempotency_key: string;
  reservation_id: string;
  request_hash: string;
  response_json: string | null;
  terminal: number;
}

export interface UsageSnapshot {
  userId: string;
  periodId: string;
  periodStart: string;
  periodEnd: string;
  limit: number;
  used: number;
  pending: number;
  remaining: number;
  recent?: LedgerRow[];
}

export interface ReconcileDrift {
  userId: string;
  periodId: string;
  counterUsed: number;
  ledgerUsed: number;
}

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class QuotaExceededError extends Error {
  readonly usage: UsageSnapshot;
  constructor(usage: UsageSnapshot) {
    super('Quota exceeded');
    this.name = 'QuotaExceededError';
    this.usage = usage;
  }
}
