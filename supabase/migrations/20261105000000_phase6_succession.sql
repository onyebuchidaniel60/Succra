-- SUCCRA Phase 6 — checkpoints and succession (PROJECT_SPEC FR-05/07/08).
--
-- mission_checkpoints stores the full verified snapshot; SuccraMission stores
-- only the monotonic sequence/hash commitment (0, 1, 2, ...). The initial
-- sequence=0 checkpoint is submitted by the runtime immediately after mission
-- creation, so a recovery boundary always exists before a quarantine.
--
-- succession_events records each activation attempt. activation_tx_hash is
-- nullable only while PENDING_ACK because the row is created before the
-- guardian's activation transaction is confirmed. A partial unique index keeps
-- at most one pending activation per mission.
--
-- RLS: owners may SELECT their mission's rows. All writes use the server-only
-- service role; no owner INSERT/UPDATE/DELETE policies exist.

-- ------------------------------------------------------ mission_checkpoints
CREATE TABLE IF NOT EXISTS public.mission_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions (id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CANDIDATE', 'VERIFIED', 'SUPERSEDED')),
  checkpoint_hash TEXT NOT NULL,
  confirmed_payment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_transaction_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
  hsp_mandate_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_spent_atomic NUMERIC(78, 0) NOT NULL,
  policy_version INTEGER NOT NULL,
  policy_hash TEXT NOT NULL,
  committed_tx_hash TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mission_id, sequence)
);

CREATE INDEX IF NOT EXISTS mission_checkpoints_mission_sequence_idx
  ON public.mission_checkpoints (mission_id, sequence DESC);

ALTER TABLE public.mission_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mission_checkpoints_owner_select ON public.mission_checkpoints;
CREATE POLICY mission_checkpoints_owner_select ON public.mission_checkpoints
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_checkpoints.mission_id AND m.owner_id = auth.uid()
    )
  );

-- ------------------------------------------------------- succession_events
CREATE TABLE IF NOT EXISTS public.succession_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions (id) ON DELETE CASCADE,
  from_agent_id UUID NULL REFERENCES public.agents (id) ON DELETE SET NULL,
  from_agent_address TEXT NOT NULL,
  to_agent_id UUID NOT NULL REFERENCES public.agents (id) ON DELETE CASCADE,
  to_agent_address TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('quarantine', 'owner_manual', 'liveness')),
  checkpoint_hash TEXT NULL,
  checkpoint_sequence BIGINT NULL,
  recovery_max_payment_atomic NUMERIC(78, 0) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_ACK', 'ACKNOWLEDGED', 'FAILED')),
  activation_tx_hash TEXT NULL,
  acknowledgement_tx_hash TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ NULL,
  CONSTRAINT succession_events_activation_tx_check
    CHECK (activation_tx_hash IS NOT NULL OR status = 'PENDING_ACK')
);

CREATE INDEX IF NOT EXISTS succession_events_mission_created_idx
  ON public.succession_events (mission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS succession_events_to_agent_idx
  ON public.succession_events (to_agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS succession_events_one_pending_idx
  ON public.succession_events (mission_id)
  WHERE status = 'PENDING_ACK';

ALTER TABLE public.succession_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS succession_events_owner_select ON public.succession_events;
CREATE POLICY succession_events_owner_select ON public.succession_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = succession_events.mission_id AND m.owner_id = auth.uid()
    )
  );

-- Deliberately no INSERT/UPDATE/DELETE policies: service-role writes only.
