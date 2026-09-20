-- SUCCRA Phase 5 — guardian quarantine tables (ARCHITECTURE.md §7).
--
-- Creates audit_events only. Phase 4 created action_requests,
-- onchain_transactions, agent_request_nonces, and agent_challenges;
-- mission_checkpoints and succession_events belong to Phase 6.
--
-- Conventions (same as prior migrations):
-- - RLS is ENABLED (not FORCED): the service-role key bypasses RLS by
--   design and stays server-only. Owner-only policies follow the mission
--   join, mirroring action_requests (public audit reads arrive later).
-- - DROP POLICY IF EXISTS before each CREATE POLICY keeps this file
--   re-runnable (idempotent-by-file, normal Supabase convention).

-- ---------------------------------------------------------- audit_events
CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id UUID NULL,
  event_hash TEXT NOT NULL,
  payload_public JSONB NOT NULL,
  onchain_signature TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_mission_id_idx
  ON public.audit_events (mission_id);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_events_owner_select ON public.audit_events;
CREATE POLICY audit_events_owner_select ON public.audit_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = audit_events.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS audit_events_owner_insert ON public.audit_events;
CREATE POLICY audit_events_owner_insert ON public.audit_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = audit_events.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS audit_events_owner_update ON public.audit_events;
CREATE POLICY audit_events_owner_update ON public.audit_events
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = audit_events.mission_id AND m.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = audit_events.mission_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS audit_events_owner_delete ON public.audit_events;
CREATE POLICY audit_events_owner_delete ON public.audit_events
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.missions m
      WHERE m.id = audit_events.mission_id AND m.owner_id = auth.uid()
    )
  );
