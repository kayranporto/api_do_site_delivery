ALTER TABLE api_clients
  ADD COLUMN expires_at TIMESTAMPTZ NULL,
  ADD COLUMN rate_limit_max INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN rate_limit_window_ms INTEGER NOT NULL DEFAULT 60000;

-- Compatibilidade segura: credenciais antigas recebem 90 dias contados da criação original.
UPDATE api_clients
SET expires_at = created_at + INTERVAL '90 days'
WHERE expires_at IS NULL;

ALTER TABLE api_clients
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE api_clients
  ADD CONSTRAINT api_clients_expiry_after_creation_check
    CHECK (expires_at > created_at),
  ADD CONSTRAINT api_clients_rate_limit_max_check
    CHECK (rate_limit_max BETWEEN 1 AND 100000),
  ADD CONSTRAINT api_clients_rate_limit_window_check
    CHECK (rate_limit_window_ms BETWEEN 1000 AND 3600000);

ALTER TABLE api_client_audit
  DROP CONSTRAINT api_client_audit_action_check;

ALTER TABLE api_client_audit
  ADD CONSTRAINT api_client_audit_action_check
    CHECK (action IN ('created', 'authenticated', 'revoked', 'rotated', 'limits_updated'));
