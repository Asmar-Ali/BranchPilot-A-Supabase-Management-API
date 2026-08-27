CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS oauth_transactions (
  state_hash bytea PRIMARY KEY,
  actor_sub text NOT NULL,
  code_verifier_ciphertext bytea NOT NULL,
  organization_slug text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS supabase_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_sub text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('connected', 'refreshing', 'revoked', 'revocation_pending')),
  access_token_ciphertext bytea,
  refresh_token_ciphertext bytea,
  access_token_expires_at timestamptz,
  token_version integer NOT NULL DEFAULT 0 CHECK (token_version >= 0),
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  last_refreshed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS branch_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_sub text NOT NULL,
  project_ref text NOT NULL,
  branch_name text NOT NULL,
  upstream_branch_ref text,
  upstream_status text,
  state text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_operations_actor_sub_idempotency_key_key UNIQUE (actor_sub, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_sub text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  outcome text NOT NULL,
  correlation_id uuid NOT NULL,
  upstream_status integer CHECK (upstream_status BETWEEN 100 AND 599),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_events_actor_sub_occurred_at_idx
  ON audit_events (actor_sub, occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_correlation_id_idx
  ON audit_events (correlation_id);
