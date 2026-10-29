-- Migration: Add adr_timeline_events to track who edited what and when
CREATE TABLE IF NOT EXISTS public.adr_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adr_id UUID NOT NULL REFERENCES public.adrs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adr_timeline_events_adr_id ON public.adr_timeline_events(adr_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_adr_timeline_events_user_id ON public.adr_timeline_events(user_id);

GRANT SELECT, INSERT ON public.adr_timeline_events TO authenticated;
GRANT ALL ON public.adr_timeline_events TO service_role;
