-- SUCCRA Phase 4 — agent gateway tables (ARCHITECTURE.md §7 + amendment v2).
--
-- Tables: action_requests, onchain_transactions (§7), agent_request_nonces
-- and agent_challenges (amendment v2 §7). Later-phase tables
-- (mission_checkpoints, succession_events, audit_events) are NOT created
-- here; they belong to the phase that first writes them.
--
-- Documented deviations from the §7 column lists (all required by the
-- amended §10 gateway behavior; reported in the Phase 4 completion report):
-- - action_requests.unsigned_tx_hash TEXT NULL: amended §10 hashing spec
--   requires storing SHA-256(message bytes) for TRANSACTION_MISMATCH
--   detection at submit time.
-- - action_requests.unsigned_tx_b64 TEXT NULL: duplicate idempotency keys
--   must return the ORIGINAL unsigned transaction, which is only
--   possible if the exact bytes are stored (rebuilding would change the
--   blockhash and invalidate agent signatures made against the original).
-- - action_requests.expires_at TIMESTAMPTZ NULL: the TRANSACTION_EXPIRED
--   check needs the body's expiresAt at submit time, after the HTTP
--   request is gone.
-- - action_requests.idempotency_key TEXT NOT NULL and agent_nonce BIGINT
--   NOT NULL: NULLs would defeat the UNIQUE money-safety constraints
--   (Postgres treats NULLs as distinct, allowing duplicate rows).
-- - onchain_transactions.signature TEXT NOT NULL: always known at insert
--   (extracted from the agent-signed transaction before submission).
-- - action_requests.violation_count_after stays NULL-able: Phase 5 owns
--   violation counters; Phase 4 never increments them.
--
-- Conventions (same as the Phase 3 migration):
-- - RLS is ENABLED (not FORCED): the service-role key bypasses RLS by
--   design and stays server-only. Product tables carry owner-only
--   policies via a mission join; agent_request_nonces and
--   agent_challenges are server-only infrastructure with NO policies.
-- - DROP POLICY IF EXISTS before each CREATE POLICY keeps this file
--   re-runnable (idempotent-by-file, normal Supabase convention).

-- ---------------------------------------------------------- action_requests
CREATE TABLE IF NOT EXISTS public.action_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions (id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents (id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  agent_nonce BIGINT NOT NULL,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  request_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  decision TEXT NOT NULL,
  decision_reason_code TEXT NULL,
  violation_count_after INTEGER NULL,
  unsigned_tx_hash TEXT NULL,
  unsigned_tx_b64 TEXT NULL,
  expires_at TIMESTAMPTZ NULL,
  submitted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mission_id, idempotency_key),
  UNIQUE (mission_id, agent_nonce)
);

CREATE INDEX IF NOT EXISTS action_requests_mission_id_idx
  ON public.action_requests (mission_id);

ALTER TABLE public.action_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS action_requests_owner_select ON public.action_requests;
CREATE POLICY action_requests_owner_select ON public.action_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = action_requests.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS action_requests_owner_insert ON public.action_requests;
CREATE POLICY action_requests_owner_insert ON public.action_requests
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = action_requests.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS action_requests_owner_update ON public.action_requests;
CREATE POLICY action_requests_owner_update ON public.action_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = action_requests.mission_id AND m.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = action_requests.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS action_requests_owner_delete ON public.action_requests;
CREATE POLICY action_requests_owner_delete ON public.action_requests
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = action_requests.mission_id AND m.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------- onchain_transactions
CREATE TABLE IF NOT EXISTS public.onchain_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions (id) ON DELETE CASCADE,
  action_request_id UUID NULL REFERENCES public.action_requests (id) ON DELETE SET NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NULL,
  status TEXT NOT NULL,
  raw_error JSONB NULL,
  confirmed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onchain_transactions_mission_id_idx
  ON public.onchain_transactions (mission_id);
CREATE INDEX IF NOT EXISTS onchain_transactions_action_request_id_idx
  ON public.onchain_transactions (action_request_id);

ALTER TABLE public.onchain_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onchain_transactions_owner_select ON public.onchain_transactions;
CREATE POLICY onchain_transactions_owner_select ON public.onchain_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = onchain_transactions.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS onchain_transactions_owner_insert ON public.onchain_transactions;
CREATE POLICY onchain_transactions_owner_insert ON public.onchain_transactions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = onchain_transactions.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS onchain_transactions_owner_update ON public.onchain_transactions;
CREATE POLICY onchain_transactions_owner_update ON public.onchain_transactions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = onchain_transactions.mission_id AND m.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = onchain_transactions.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS onchain_transactions_owner_delete ON public.onchain_transactions;
CREATE POLICY onchain_transactions_owner_delete ON public.onchain_transactions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = onchain_transactions.mission_id AND m.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------- agent_request_nonces
-- Server-only HTTP replay-protection for agent-signed requests
-- (amendment v2 §7 + §12). Single-use is enforced by consumers:
--   INSERT (agent_id, nonce, expires_at) then
--   UPDATE agent_request_nonces SET consumed_at = now()
--   WHERE agent_id = $1 AND nonce = $2 AND consumed_at IS NULL
--   RETURNING *
-- A unique-violation on INSERT is itself a replay signal. Stale rows are
-- swept opportunistically by the application on write (no cron).
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
-- Deliberately NO policies: read/written exclusively with the
-- server-side service-role key (which bypasses RLS).

-- --------------------------------------------------------- agent_challenges
-- Server-only registration challenges (amendment v2 §7 + §10).
-- Single-use enforced via UPDATE ... WHERE consumed_at IS NULL
-- AND expires_at > now() RETURNING.
CREATE TABLE IF NOT EXISTS public.agent_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents (id) ON DELETE CASCADE,
  challenge TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_challenges_agent_id_idx
  ON public.agent_challenges (agent_id);

ALTER TABLE public.agent_challenges ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies: read/written exclusively with the
-- server-side service-role key (which bypasses RLS).
