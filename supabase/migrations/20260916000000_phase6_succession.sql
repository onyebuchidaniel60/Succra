-- SUCCRA Phase 6 — checkpoints + succession tables (ARCHITECTURE.md §7).
--
-- Creates mission_checkpoints and succession_events only. audit_events
-- already exists (Phase 5); no existing table is altered here.
--
-- Conventions (same as prior migrations):
-- - Field names, types, PKs, FKs, UNIQUE and NOT NULL markers mirror §7
--   exactly. created_at is TIMESTAMPTZ NOT NULL DEFAULT now().
-- - No CHECK constraints on status TEXT columns: value sets may grow
--   (CANDIDATE is reserved and unused in Phase 6; HALTED is a DB-only
--   mirror state), and a CHECK here would reject legitimate future
--   states (audit_events precedent: unconstrained TEXT).
-- - checkpoint_id carries no FK: §7 marks it UUID NULL with no
--   reference, so none is added.
-- - RLS is ENABLED (not FORCED): the service-role key bypasses RLS by
--   design and stays server-only. Owner-only policies follow the mission
--   join. No public read policies: public audit read is a later phase.
-- - DROP POLICY IF EXISTS before each CREATE POLICY keeps this file
--   re-runnable (idempotent-by-file, normal Supabase convention).

-- ------------------------------------------------------- mission_checkpoints
CREATE TABLE IF NOT EXISTS public.mission_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions (id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL,
  status TEXT NOT NULL,
  checkpoint_hash TEXT NOT NULL,
  confirmed_action_ids JSONB NOT NULL,
  remaining_budget_atomic NUMERIC(78, 0) NOT NULL,
  state_snapshot JSONB NOT NULL,
  committed_signature TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mission_id, sequence)
);

CREATE INDEX IF NOT EXISTS mission_checkpoints_mission_id_idx
  ON public.mission_checkpoints (mission_id);

ALTER TABLE public.mission_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mission_checkpoints_owner_select ON public.mission_checkpoints;
CREATE POLICY mission_checkpoints_owner_select ON public.mission_checkpoints
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_checkpoints.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mission_checkpoints_owner_insert ON public.mission_checkpoints;
CREATE POLICY mission_checkpoints_owner_insert ON public.mission_checkpoints
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_checkpoints.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mission_checkpoints_owner_update ON public.mission_checkpoints;
CREATE POLICY mission_checkpoints_owner_update ON public.mission_checkpoints
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_checkpoints.mission_id AND m.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_checkpoints.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mission_checkpoints_owner_delete ON public.mission_checkpoints;
CREATE POLICY mission_checkpoints_owner_delete ON public.mission_checkpoints
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = mission_checkpoints.mission_id AND m.owner_id = auth.uid()
    )
  );

-- -------------------------------------------------------- succession_events
CREATE TABLE IF NOT EXISTS public.succession_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions (id) ON DELETE CASCADE,
  from_agent_id UUID NULL,
  to_agent_id UUID NOT NULL,
  trigger_type TEXT NOT NULL,
  checkpoint_id UUID NULL,
  recovery_limit_atomic NUMERIC(78, 0) NOT NULL,
  status TEXT NOT NULL,
  onchain_signature TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS succession_events_mission_id_idx
  ON public.succession_events (mission_id);

ALTER TABLE public.succession_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS succession_events_owner_select ON public.succession_events;
CREATE POLICY succession_events_owner_select ON public.succession_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = succession_events.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS succession_events_owner_insert ON public.succession_events;
CREATE POLICY succession_events_owner_insert ON public.succession_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = succession_events.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS succession_events_owner_update ON public.succession_events;
CREATE POLICY succession_events_owner_update ON public.succession_events
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = succession_events.mission_id AND m.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = succession_events.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS succession_events_owner_delete ON public.succession_events;
CREATE POLICY succession_events_owner_delete ON public.succession_events
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = succession_events.mission_id AND m.owner_id = auth.uid()
    )
  );
