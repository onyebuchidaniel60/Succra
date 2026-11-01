-- SUCCRA Phase 5 — violation recording, quarantine, and immutable audit rows.
--
-- audit_events already exists from the Solana-era Phase 5 migration. This
-- migration keeps its data and legacy `onchain_signature` column, adds the
-- HashKey `onchain_tx_hash` column, and narrows RLS to the Phase 5 contract:
-- owners may SELECT their mission's rows; all writes use the server-only
-- service role. No owner INSERT/UPDATE/DELETE policies remain, so audit rows
-- are immutable to browser/authenticated callers.
--
-- Phase 5 event types written by the application:
--   violation.counted          preflight BLOCK with a countable policy code
--   violation.threshold_reached runtime crosses the on-chain threshold
--   quarantine.submitted        guardian/owner quarantine transaction sent
--   quarantine.confirmed        quarantine transaction confirmed on-chain
--
-- Countable violations (PROJECT_SPEC.md §6): INVALID_ACTION_TYPE,
-- MERCHANT_NOT_ALLOWED, TOKEN_NOT_ALLOWED, AMOUNT_EXCEEDS_MAX, and
-- BUDGET_EXHAUSTED. Authentication, replay, idempotency, and environmental
-- rejections never enter this table as counted violations.
--
-- action_requests gains recorder bookkeeping. `violation_attempts` and
-- `violation_poisoned` bound retries: after three failed submissions the row
-- is parked for Phase 9 alerting instead of blocking the queue forever.
--
-- agents.status is finally constrained to the Phase 4/5 state machine. The
-- migration validates existing rows; an out-of-set status makes it fail rather
-- than silently accepting an unknown state.

-- ------------------------------------------------------------ audit_events
ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS onchain_tx_hash TEXT NULL;

CREATE INDEX IF NOT EXISTS audit_events_mission_created_idx
  ON public.audit_events (mission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_mission_event_type_idx
  ON public.audit_events (mission_id, event_type);

-- Owner reads follow the mission join. No INSERT/UPDATE/DELETE policies:
-- the service role is the only writer and audit rows are immutable to clients.
DROP POLICY IF EXISTS audit_events_owner_insert ON public.audit_events;
DROP POLICY IF EXISTS audit_events_owner_update ON public.audit_events;
DROP POLICY IF EXISTS audit_events_owner_delete ON public.audit_events;

-- -------------------------------------------------------- action_requests
ALTER TABLE public.action_requests
  ADD COLUMN IF NOT EXISTS violation_recorded_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS violation_recorded_tx_hash TEXT NULL,
  ADD COLUMN IF NOT EXISTS violation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS violation_poisoned BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS action_requests_violation_pending_idx
  ON public.action_requests (created_at ASC)
  WHERE decision = 'BLOCK'
    AND violation_recorded_at IS NULL
    AND violation_poisoned = false;

-- ------------------------------------------------------------------ agents
ALTER TABLE public.agents
  DROP CONSTRAINT IF EXISTS agents_status_check;

ALTER TABLE public.agents
  ADD CONSTRAINT agents_status_check
  CHECK (
    status IN (
      'REGISTERED',
      'PENDING',
      'ACTIVE_PRIMARY',
      'ACTIVE_SUCCESSOR',
      'QUARANTINED',
      'REVOKED'
    )
  ) NOT VALID;

-- Fails if any pre-existing row carries a status outside the state machine.
ALTER TABLE public.agents
  VALIDATE CONSTRAINT agents_status_check;
