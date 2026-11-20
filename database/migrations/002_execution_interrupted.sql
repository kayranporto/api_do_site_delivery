-- Add a terminal state for stale executions. This migration is applied after 001.
ALTER TABLE executions
  DROP CONSTRAINT IF EXISTS executions_status_check;

ALTER TABLE executions
  ADD CONSTRAINT executions_status_check
  CHECK (status IN (
    'pending',
    'running',
    'retry_scheduled',
    'succeeded',
    'failed',
    'cancelled',
    'interrupted'
  ));

CREATE INDEX executions_stale_recovery_idx
  ON executions (created_at)
  WHERE status IN ('pending', 'running');
