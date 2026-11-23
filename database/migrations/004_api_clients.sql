CREATE TABLE api_clients (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  key_prefix CHAR(16) NOT NULL UNIQUE,
  key_hash CHAR(64) NOT NULL,
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0),
  integration_ids TEXT[] NULL,
  created_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  last_used_at TIMESTAMPTZ NULL,
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (last_used_at IS NULL OR last_used_at >= created_at),
  CHECK (array_position(scopes, NULL) IS NULL),
  CHECK (integration_ids IS NULL OR array_position(integration_ids, NULL) IS NULL)
);

CREATE INDEX api_clients_active_prefix_idx
  ON api_clients (key_prefix)
  WHERE revoked_at IS NULL;

CREATE TABLE api_client_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES api_clients(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('created', 'authenticated', 'revoked')),
  request_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX api_client_audit_client_created_idx
  ON api_client_audit (client_id, created_at DESC);
