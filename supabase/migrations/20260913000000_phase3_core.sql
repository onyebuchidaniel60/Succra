-- SUCCRA Phase 3 — core tables + RLS (ARCHITECTURE.md §7, Phase 3 subset).
--
-- Tables: profiles, agents, missions, mission_agents, mission_policies.
-- Later-phase tables (mission_checkpoints, action_requests,
-- onchain_transactions, succession_events, audit_events) are NOT created
-- here; they belong to the phase that first writes them.
--
-- auth_nonces IS created here even though §7 does not list it: §7 defines
-- the product data model, not implementation tables, and the required
-- POST /api/auth/nonce + POST /api/auth/verify endpoints need
-- multi-instance-safe, single-use nonce storage. An in-memory store would
-- fail nondeterministically on serverless/multi-instance hosts, so nonces
-- live in Postgres. auth_nonces is server-only infrastructure (see RLS
-- note below), not product data, and adding it does not violate §7.
--
-- Conventions:
-- - Field names, types, PKs, FKs, UNIQUE and NOT NULL markers mirror §7
--   exactly. created_at/updated_at are TIMESTAMPTZ NOT NULL DEFAULT now().
-- - mission_policies and mission_agents carry no updated_at column because
--   §7 does not list one for them.
-- - No CHECK constraints on status/role TEXT columns: later phases extend
--   those state machines (QUARANTINED, RECOVERING, ...), and a CHECK here
--   would reject legitimate future states.
-- - FK delete behavior is not specified by §7; CASCADE keeps child rows
--   (policies, assignments) from orphaning, except
--   missions.current_agent_id which is SET NULL so a mission survives
--   agent-row deletion.
-- - owner_id columns are NOT NULL: §12 requires every row to be
--   ownership-scoped, and RLS policies below assume an owner exists.
-- - RLS is ENABLED (not FORCED): the service-role key bypasses RLS by
--   design and stays server-only. Every policy is owner-only
--   (owner_id = auth.uid(), directly or via a mission join). No public
--   read policies: public audit read is a later phase.
-- - DROP POLICY IF EXISTS before each CREATE POLICY keeps this file
--   re-runnable (idempotent-by-file, normal Supabase convention).

-- ---------------------------------------------------------------- profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  wallet_address TEXT UNIQUE NOT NULL,
  display_name TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_owner_select ON public.profiles;
CREATE POLICY profiles_owner_select ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS profiles_owner_insert ON public.profiles;
CREATE POLICY profiles_owner_insert ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS profiles_owner_update ON public.profiles;
CREATE POLICY profiles_owner_update ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS profiles_owner_delete ON public.profiles;
CREATE POLICY profiles_owner_delete ON public.profiles
  FOR DELETE USING (auth.uid() = id);

-- ------------------------------------------------------------------ agents
CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  public_key TEXT UNIQUE NOT NULL,
  endpoint_url TEXT NULL,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL,
  last_heartbeat_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agents_owner_id_idx ON public.agents (owner_id);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agents_owner_select ON public.agents;
CREATE POLICY agents_owner_select ON public.agents
  FOR SELECT USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS agents_owner_insert ON public.agents;
CREATE POLICY agents_owner_insert ON public.agents
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS agents_owner_update ON public.agents;
CREATE POLICY agents_owner_update ON public.agents
  FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS agents_owner_delete ON public.agents;
CREATE POLICY agents_owner_delete ON public.agents
  FOR DELETE USING (auth.uid() = owner_id);

-- ----------------------------------------------------------------- missions
CREATE TABLE IF NOT EXISTS public.missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  pda_address TEXT UNIQUE NOT NULL,
  vault_address TEXT UNIQUE NOT NULL,
  mint_address TEXT NOT NULL,
  budget_atomic NUMERIC(78, 0) NOT NULL,
  remaining_budget_atomic NUMERIC(78, 0) NOT NULL,
  status TEXT NOT NULL,
  current_agent_id UUID NULL REFERENCES public.agents (id) ON DELETE SET NULL,
  current_agent_public_key TEXT NOT NULL,
  policy_version INTEGER NOT NULL DEFAULT 1,
  policy_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS missions_owner_id_idx ON public.missions (owner_id);

ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS missions_owner_select ON public.missions;
CREATE POLICY missions_owner_select ON public.missions
  FOR SELECT USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS missions_owner_insert ON public.missions;
CREATE POLICY missions_owner_insert ON public.missions
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS missions_owner_update ON public.missions;
CREATE POLICY missions_owner_update ON public.missions
  FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS missions_owner_delete ON public.missions;
CREATE POLICY missions_owner_delete ON public.missions
  FOR DELETE USING (auth.uid() = owner_id);

-- ----------------------------------------------------------- mission_agents
CREATE TABLE IF NOT EXISTS public.mission_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions (id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents (id) ON DELETE CASCADE,
  role TEXT NULL,
  priority INTEGER NULL,
  required_capabilities JSONB NULL,
  status TEXT NULL,
  activated_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  UNIQUE (mission_id, agent_id)
);

CREATE INDEX IF NOT EXISTS mission_agents_mission_id_idx ON public.mission_agents (mission_id);
CREATE INDEX IF NOT EXISTS mission_agents_agent_id_idx ON public.mission_agents (agent_id);

ALTER TABLE public.mission_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mission_agents_owner_select ON public.mission_agents;
CREATE POLICY mission_agents_owner_select ON public.mission_agents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_agents.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mission_agents_owner_insert ON public.mission_agents;
CREATE POLICY mission_agents_owner_insert ON public.mission_agents
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_agents.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mission_agents_owner_update ON public.mission_agents;
CREATE POLICY mission_agents_owner_update ON public.mission_agents
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_agents.mission_id AND m.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_agents.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mission_agents_owner_delete ON public.mission_agents;
CREATE POLICY mission_agents_owner_delete ON public.mission_agents
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_agents.mission_id AND m.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------- mission_policies
CREATE TABLE IF NOT EXISTS public.mission_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions (id) ON DELETE CASCADE,
  version INTEGER NULL,
  max_action_atomic NUMERIC(78, 0) NULL,
  recovery_max_action_atomic NUMERIC(78, 0) NULL,
  allowed_action_types JSONB NULL,
  allowed_recipients JSONB NULL,
  violation_threshold INTEGER NULL DEFAULT 3,
  violation_window_seconds INTEGER NULL DEFAULT 900,
  policy_json JSONB NOT NULL,
  policy_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mission_policies_mission_id_idx ON public.mission_policies (mission_id);

ALTER TABLE public.mission_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mission_policies_owner_select ON public.mission_policies;
CREATE POLICY mission_policies_owner_select ON public.mission_policies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_policies.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mission_policies_owner_insert ON public.mission_policies;
CREATE POLICY mission_policies_owner_insert ON public.mission_policies
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_policies.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mission_policies_owner_update ON public.mission_policies;
CREATE POLICY mission_policies_owner_update ON public.mission_policies
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_policies.mission_id AND m.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_policies.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mission_policies_owner_delete ON public.mission_policies;
CREATE POLICY mission_policies_owner_delete ON public.mission_policies
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_policies.mission_id AND m.owner_id = auth.uid()
    )
  );

-- ------------------------------------------------------------- auth_nonces
-- Server-only login-nonce infrastructure for POST /api/auth/nonce +
-- POST /api/auth/verify (NOT a product table; see header rationale).
-- Single-use is enforced atomically by consumers:
--   UPDATE auth_nonces SET consumed_at = now()
--   WHERE nonce = $1 AND wallet_address = $2
--     AND consumed_at IS NULL AND expires_at > now()
--   RETURNING *
-- Stale rows are swept opportunistically by the application on write
-- (no cron in Phase 3).
CREATE TABLE IF NOT EXISTS public.auth_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_nonces_wallet_expires_idx
  ON public.auth_nonces (wallet_address, expires_at);

ALTER TABLE public.auth_nonces ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies: anon and authenticated roles get nothing.
-- Nonces are server-only infrastructure, read/written exclusively with the
-- server-side service-role key (which bypasses RLS). End-user sessions and
-- the browser must never see this table.
