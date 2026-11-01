-- SUCCRA Phase 2 — HSP preflight (ARCHITECTURE.md §7, §10, §12).
--
-- Extends the Phase 4 action_requests table rather than recreating it:
-- Phase 4's Solana-shaped columns remain for compatibility, while the
-- HSP preflight adds the request/on-chain/mandate fields it needs.
--
-- Legacy rows from the Solana gateway receive a generated request_id and a
-- zero onchain_request_id default. Those rows are not valid HSP preflights;
-- the defaults are dropped after the ALTER so all new inserts must supply
-- real values. This is a migration-safety compromise, not a runtime default.
--
-- RLS: action_requests keeps owner-scoped SELECT only. INSERT/UPDATE/DELETE
-- policies are dropped because the gateway writes with the service-role key.
-- agent_request_nonces remains service-role only with no policies.

ALTER TABLE public.action_requests
  ADD COLUMN IF NOT EXISTS request_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN IF NOT EXISTS onchain_request_id TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000',
  ADD COLUMN IF NOT EXISTS mandate_hash TEXT NULL,
  ADD COLUMN IF NOT EXISTS mandate_payload JSONB NULL,
  ADD COLUMN IF NOT EXISTS typed_data JSONB NULL;

ALTER TABLE public.action_requests
  ALTER COLUMN request_id DROP DEFAULT,
  ALTER COLUMN onchain_request_id DROP DEFAULT,
  ALTER COLUMN signature DROP NOT NULL;

UPDATE public.action_requests
SET expires_at = created_at
WHERE expires_at IS NULL;

ALTER TABLE public.action_requests
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS action_requests_mission_created_idx
  ON public.action_requests (mission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS action_requests_request_id_idx
  ON public.action_requests (request_id);

-- Gateway writes go through the service role. Owners may only read.
DROP POLICY IF EXISTS action_requests_owner_insert ON public.action_requests;
DROP POLICY IF EXISTS action_requests_owner_update ON public.action_requests;
DROP POLICY IF EXISTS action_requests_owner_delete ON public.action_requests;

-- The Phase 4 table is already present; this is a no-op on fresh databases
-- but documents the required shape and keeps the migration self-contained.
CREATE TABLE IF NOT EXISTS public.agent_request_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents (id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, nonce)
);

CREATE INDEX IF NOT EXISTS agent_request_nonces_agent_expires_idx
  ON public.agent_request_nonces (agent_id, expires_at);

ALTER TABLE public.agent_request_nonces ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: service-role only.
