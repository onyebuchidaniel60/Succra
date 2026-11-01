-- SUCCRA Phase 4 — EVM agent schema, challenges, and RLS (ARCHITECTURE.md §7).
--
-- The original agents table used Solana-era `public_key`. Phase 4 adds the
-- EVM `address` column and keeps `public_key` as a legacy column until Phase 7.
-- A compatibility trigger mirrors legacy inserts so existing code/tests stay
-- valid while new code uses `address`.
--
-- Status values are harmonized to:
--   PENDING, REGISTERED, ACTIVE_PRIMARY, ACTIVE_SUCCESSOR, QUARANTINED, REVOKED
-- `PENDING` is the pre-verification state; `REGISTERED` means address ownership
-- has been proven. No CHECK constraint is added because later phases extend
-- this state machine.
--
-- RLS: owners keep SELECT/INSERT/DELETE on their own agents/assignments for
-- compatibility, but status transitions are service-role-only (the owner
-- UPDATE policies are dropped). agent_challenges remains service-role only.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS address TEXT;

UPDATE public.agents
SET address = public_key
WHERE address IS NULL;

CREATE OR REPLACE FUNCTION public.agents_sync_address()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.address IS NULL THEN
    NEW.address := NEW.public_key;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agents_sync_address ON public.agents;
CREATE TRIGGER agents_sync_address
  BEFORE INSERT OR UPDATE ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.agents_sync_address();

ALTER TABLE public.agents
  ALTER COLUMN address SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agents_address_key
  ON public.agents (address);
CREATE INDEX IF NOT EXISTS agents_owner_address_idx
  ON public.agents (owner_id, address);

-- Status changes are applied by the server-only service role. Owners may
-- still read their agents; the update policy is removed to prevent browser
-- callers from self-verifying or self-activating.
DROP POLICY IF EXISTS agents_owner_update ON public.agents;

ALTER TABLE public.mission_agents
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN required_capabilities SET DEFAULT '[]'::jsonb,
  ALTER COLUMN status SET DEFAULT 'REGISTERED';

UPDATE public.mission_agents
SET role = 'PRIMARY'
WHERE role IS NULL;

UPDATE public.mission_agents
SET required_capabilities = '[]'::jsonb
WHERE required_capabilities IS NULL;

UPDATE public.mission_agents
SET status = 'REGISTERED'
WHERE status IS NULL;

ALTER TABLE public.mission_agents
  ALTER COLUMN required_capabilities SET NOT NULL,
  ALTER COLUMN status SET NOT NULL;

DROP POLICY IF EXISTS mission_agents_owner_update ON public.mission_agents;

-- Challenges are already EVM-shaped; add the explicit uniqueness/indexes
-- required by Phase 4. No signature column is needed: the signature is
-- verified against the EIP-712 typed data at consume time.
CREATE UNIQUE INDEX IF NOT EXISTS agent_challenges_agent_challenge_key
  ON public.agent_challenges (agent_id, challenge);
CREATE INDEX IF NOT EXISTS agent_challenges_unconsumed_expires_idx
  ON public.agent_challenges (expires_at)
  WHERE consumed_at IS NULL;
