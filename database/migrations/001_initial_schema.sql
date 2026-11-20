CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  configuration_reference TEXT NOT NULL,
  secret_reference TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 100 AND 120000),
  retry_policy JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (updated_at >= created_at)
);

CREATE INDEX integrations_provider_key_idx
  ON integrations (provider_key, created_at);

CREATE INDEX integrations_active_created_idx
  ON integrations (created_at)
  WHERE status = 'active';

CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE RESTRICT,
  operation_name TEXT NOT NULL,
  input JSONB NULL,
  idempotency_key TEXT NULL,
  retry_policy JSONB NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'retry_scheduled', 'succeeded', 'failed', 'cancelled')
  ),
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_attempt_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  lease_token TEXT NULL,
  lease_until TIMESTAMPTZ NULL,
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);

CREATE UNIQUE INDEX executions_integration_id_idempotency_key_uidx
  ON executions (integration_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX executions_due_retry_idx
  ON executions (next_attempt_at, created_at)
  WHERE status = 'retry_scheduled';

CREATE INDEX executions_integration_created_idx
  ON executions (integration_id, created_at DESC);
