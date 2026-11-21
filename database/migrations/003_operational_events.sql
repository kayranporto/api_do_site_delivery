CREATE TABLE execution_events (
  id UUID PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'execution.attempt_started',
    'execution.attempt_succeeded',
    'execution.attempt_failed',
    'execution.retry_cancelled',
    'execution.interrupted',
    'execution.reconciliation_requested',
    'execution.reconciliation_completed',
    'execution.reconciliation_unsupported',
    'execution.reconciliation_failed'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX execution_events_execution_created_idx
  ON execution_events (execution_id, created_at DESC, id DESC);

CREATE INDEX execution_events_created_severity_idx
  ON execution_events (created_at DESC, severity);
