-- SUCCRA Phase 3 — HashKey mission columns + HSP payment/settlement tables.
--
-- Mission schema debt (ARCHITECTURE.md §7): the original core table used
-- Solana-shaped names. Phase 3 adds the HashKey-shaped columns and keeps the
-- legacy columns until Phase 7. A BEFORE INSERT/UPDATE trigger mirrors the
-- legacy columns into the new columns so existing code/tests remain valid
-- while new code prefers the HashKey columns.
--
-- hsp_payments and hsp_webhook_events are settlement mirrors, never the
-- source of truth. HSP/HashKey remain authoritative (AGENTS.md invariant #4).
--
-- RLS: hsp_payments is owner-readable via the mission join and service-role
-- writable only (no INSERT/UPDATE/DELETE policies). hsp_webhook_events is
-- service-role only with RLS enabled and no policies.

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS contract_address TEXT,
  ADD COLUMN IF NOT EXISTS factory_address TEXT,
  ADD COLUMN IF NOT EXISTS owner_address TEXT,
  ADD COLUMN IF NOT EXISTS payment_token_address TEXT,
  ADD COLUMN IF NOT EXISTS current_agent_address TEXT;

-- Backfill from the legacy columns where possible. factory_address has no
-- legacy source; legacy rows receive the zero address placeholder and are
-- expected to be re-created with the real factory in a later phase.
UPDATE public.missions AS m
SET contract_address = COALESCE(m.contract_address, m.pda_address),
    payment_token_address = COALESCE(m.payment_token_address, m.mint_address),
    current_agent_address = COALESCE(m.current_agent_address, m.current_agent_public_key),
    owner_address = COALESCE(m.owner_address, p.wallet_address),
    factory_address = COALESCE(
      m.factory_address,
      '0x0000000000000000000000000000000000000000'
    )
FROM public.profiles AS p
WHERE p.id = m.owner_id;

UPDATE public.missions
SET owner_address = COALESCE(owner_address, '0x0000000000000000000000000000000000000000'),
    factory_address = COALESCE(factory_address, '0x0000000000000000000000000000000000000000')
WHERE owner_address IS NULL OR factory_address IS NULL;

-- Compatibility bridge for old inserts/tests that only know the legacy
-- columns. New code writes the HashKey columns explicitly.
-- TODO(phase-7): remove this trigger when Solana columns are dropped from missions.
CREATE OR REPLACE FUNCTION public.missions_sync_hashkey_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contract_address IS NULL THEN
    NEW.contract_address := NEW.pda_address;
  END IF;
  IF NEW.payment_token_address IS NULL THEN
    NEW.payment_token_address := NEW.mint_address;
  END IF;
  IF NEW.current_agent_address IS NULL THEN
    NEW.current_agent_address := NEW.current_agent_public_key;
  END IF;
  IF NEW.owner_address IS NULL THEN
    SELECT p.wallet_address INTO NEW.owner_address
    FROM public.profiles AS p
    WHERE p.id = NEW.owner_id;
  END IF;
  IF NEW.factory_address IS NULL THEN
    NEW.factory_address := '0x0000000000000000000000000000000000000000';
  END IF;
  RETURN NEW;
END;
$$;

-- TODO(phase-7): remove this trigger when Solana columns are dropped from missions.
DROP TRIGGER IF EXISTS missions_sync_hashkey_columns ON public.missions;
CREATE TRIGGER missions_sync_hashkey_columns
  BEFORE INSERT OR UPDATE ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.missions_sync_hashkey_columns();

ALTER TABLE public.missions
  ALTER COLUMN contract_address SET NOT NULL,
  ALTER COLUMN factory_address SET NOT NULL,
  ALTER COLUMN owner_address SET NOT NULL,
  ALTER COLUMN payment_token_address SET NOT NULL,
  ALTER COLUMN current_agent_address SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS missions_contract_address_key
  ON public.missions (contract_address);
CREATE INDEX IF NOT EXISTS missions_owner_address_idx
  ON public.missions (owner_address);
CREATE INDEX IF NOT EXISTS missions_current_agent_address_idx
  ON public.missions (current_agent_address);

-- ------------------------------------------------------------ hsp_payments
-- Settlement mirror only. Authoritative state is HSP + HashKey.
CREATE TABLE IF NOT EXISTS public.hsp_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions (id) ON DELETE CASCADE,
  action_request_id UUID NOT NULL REFERENCES public.action_requests (id) ON DELETE CASCADE,
  hsp_payment_mandate_id TEXT UNIQUE NOT NULL,
  mandate_hash TEXT NOT NULL,
  amount_atomic NUMERIC(78, 0) NOT NULL,
  token_address TEXT NOT NULL,
  merchant_address TEXT NOT NULL,
  status TEXT NOT NULL,
  authorization_tx_hash TEXT NULL,
  settlement_tx_hash TEXT UNIQUE NULL,
  block_number BIGINT NULL,
  raw_error JSONB NULL,
  submitted_at TIMESTAMPTZ NULL,
  settled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hsp_payments_mission_created_idx
  ON public.hsp_payments (mission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hsp_payments_action_request_idx
  ON public.hsp_payments (action_request_id);

ALTER TABLE public.hsp_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hsp_payments_owner_select ON public.hsp_payments;
CREATE POLICY hsp_payments_owner_select ON public.hsp_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = hsp_payments.mission_id AND m.owner_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies: writes use the server-only service role.

-- ------------------------------------------------------ hsp_webhook_events
CREATE TABLE IF NOT EXISTS public.hsp_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hsp_payment_mandate_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_hash TEXT UNIQUE NOT NULL,
  payload JSONB NOT NULL,
  signature_verified BOOLEAN NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ NULL,
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS hsp_webhook_events_mandate_idx
  ON public.hsp_webhook_events (hsp_payment_mandate_id);
CREATE INDEX IF NOT EXISTS hsp_webhook_events_unprocessed_idx
  ON public.hsp_webhook_events (processed_at)
  WHERE processed_at IS NULL;

ALTER TABLE public.hsp_webhook_events ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: service-role only.

-- Atomic budget mirror for confirmed settlements. HSP remains authoritative;
-- this only keeps the off-chain mirror conservative and race-safe.
-- NOTE: hsp_payments status and this mirror are updated by separate statements
-- in the web/runtime flow. That is safe because SuccraMission.confirmedSpentAtomic
-- is the authoritative spend check; a stale mirror can only block conservatively.
CREATE OR REPLACE FUNCTION public.mirror_confirmed_spend(
  p_mission_id UUID,
  p_amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
AS $$
  UPDATE public.missions
  SET remaining_budget_atomic = GREATEST(remaining_budget_atomic - p_amount, 0),
      updated_at = now()
  WHERE id = p_mission_id
  RETURNING remaining_budget_atomic;
$$;
