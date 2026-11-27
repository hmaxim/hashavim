export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usage_ledger (
  usage_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RESERVED','COMMITTED','RELEASED','REJECTED_QUOTA')),
  reservation_id TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits >= 0),
  limit_at_time_of_use INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  settled_at TEXT,
  ai_outcome TEXT,
  latency_ms INTEGER,
  error_code TEXT,
  request_hash TEXT,
  expire_at TEXT,
  release_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_ledger_user_period_status
  ON usage_ledger(user_id, period_id, status);

CREATE INDEX IF NOT EXISTS idx_ledger_reservation
  ON usage_ledger(reservation_id);

CREATE INDEX IF NOT EXISTS idx_ledger_expire
  ON usage_ledger(status, expire_at);

-- At most one terminal settle row per reservation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_terminal_settle
  ON usage_ledger(reservation_id)
  WHERE status IN ('COMMITTED', 'RELEASED');

-- One reserve (or reject) event per idempotency key per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_idempotency_reserve
  ON usage_ledger(user_id, idempotency_key)
  WHERE status IN ('RESERVED', 'REJECTED_QUOTA');

CREATE TABLE IF NOT EXISTS quota_counters (
  user_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (user_id, period_id)
);

CREATE TABLE IF NOT EXISTS user_limits (
  user_id TEXT PRIMARY KEY,
  limit_override INTEGER NOT NULL CHECK (limit_override >= 0)
);

CREATE TABLE IF NOT EXISTS idempotency_index (
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT,
  terminal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE TRIGGER IF NOT EXISTS usage_ledger_no_update
BEFORE UPDATE ON usage_ledger
BEGIN
  SELECT RAISE(ABORT, 'usage_ledger is append-only');
END;

CREATE TRIGGER IF NOT EXISTS usage_ledger_no_delete
BEFORE DELETE ON usage_ledger
BEGIN
  SELECT RAISE(ABORT, 'usage_ledger is append-only');
END;
`;
