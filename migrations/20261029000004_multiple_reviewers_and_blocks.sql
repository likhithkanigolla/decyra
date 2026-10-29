-- Migration: Add adr_review_requests table for requesting reviews from multiple reviewers

CREATE TABLE IF NOT EXISTS public.adr_review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adr_id UUID NOT NULL REFERENCES public.adrs(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed' | 'revoked'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (adr_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_adr_review_requests_adr ON public.adr_review_requests(adr_id);
CREATE INDEX IF NOT EXISTS idx_adr_review_requests_reviewer ON public.adr_review_requests(reviewer_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.adr_review_requests TO authenticated;
GRANT ALL ON public.adr_review_requests TO service_role;
