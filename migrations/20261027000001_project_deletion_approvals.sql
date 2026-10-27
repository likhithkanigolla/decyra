-- =============================================================================
-- Migration: 20261027000001_project_deletion_approvals.sql
-- Adds table to track multi-approval requirements for project deletion
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.project_deletion_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_deletion_approvals_project_id
  ON public.project_deletion_approvals(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_deletion_approvals TO authenticated;
GRANT ALL ON public.project_deletion_approvals TO service_role;
