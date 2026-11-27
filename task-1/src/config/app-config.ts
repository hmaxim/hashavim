export type PeriodKind = 'daily' | 'monthly';

export interface AppConfig {
  port: number;
  dbPath: string;
  defaultLimit: number;
  period: PeriodKind;
  aiFailureRate: number;
  aiMinDelayMs: number;
  aiMaxDelayMs: number;
  aiTimeoutMs: number;
  reservationTtlSeconds: number;
  sweeperIntervalMs: number;
}

function requireInt(name: string, raw: string | undefined, fallback: number): number {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer, got: ${raw}`);
  }
  return value;
}

function requireNumber(name: string, raw: string | undefined, fallback: number): number {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number, got: ${raw}`);
  }
  return value;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const periodRaw = (env.PERIOD ?? 'daily').toLowerCase();
  if (periodRaw !== 'daily' && periodRaw !== 'monthly') {
    throw new Error(`PERIOD must be daily or monthly, got: ${env.PERIOD}`);
  }

  const defaultLimit = requireInt('DEFAULT_LIMIT', env.DEFAULT_LIMIT, 100);
  if (defaultLimit < 0) {
    throw new Error(`DEFAULT_LIMIT must be >= 0, got: ${defaultLimit}`);
  }

  const aiFailureRate = requireNumber('AI_FAILURE_RATE', env.AI_FAILURE_RATE, 0.15);
  if (aiFailureRate < 0 || aiFailureRate > 1) {
    throw new Error(`AI_FAILURE_RATE must be between 0 and 1, got: ${aiFailureRate}`);
  }

  const aiMinDelayMs = requireInt('AI_MIN_DELAY_MS', env.AI_MIN_DELAY_MS, 50);
  const aiMaxDelayMs = requireInt('AI_MAX_DELAY_MS', env.AI_MAX_DELAY_MS, 500);
  if (aiMinDelayMs < 0 || aiMaxDelayMs < aiMinDelayMs) {
    throw new Error('AI delay range is invalid');
  }

  const aiTimeoutMs = requireInt('AI_TIMEOUT_MS', env.AI_TIMEOUT_MS, 2000);
  if (aiTimeoutMs <= 0) {
    throw new Error('AI_TIMEOUT_MS must be > 0');
  }

  const reservationTtlSeconds = requireInt(
    'RESERVATION_TTL_SECONDS',
    env.RESERVATION_TTL_SECONDS,
    30,
  );
  if (reservationTtlSeconds <= 0) {
    throw new Error('RESERVATION_TTL_SECONDS must be > 0');
  }

  const port = requireInt('PORT', env.PORT, 3000);
  if (port <= 0 || port > 65535) {
    throw new Error(`PORT out of range: ${port}`);
  }

  const sweeperIntervalMs = requireInt('SWEEPER_INTERVAL_MS', env.SWEEPER_INTERVAL_MS, 5000);
  if (sweeperIntervalMs <= 0) {
    throw new Error('SWEEPER_INTERVAL_MS must be > 0');
  }

  const dbPath = env.DB_PATH?.trim() || './data/usage.db';

  return {
    port,
    dbPath,
    defaultLimit,
    period: periodRaw,
    aiFailureRate,
    aiMinDelayMs,
    aiMaxDelayMs,
    aiTimeoutMs,
    reservationTtlSeconds,
    sweeperIntervalMs,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
