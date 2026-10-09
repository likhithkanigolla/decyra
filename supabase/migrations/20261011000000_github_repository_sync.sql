ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS github_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS github_sync_last_commit TEXT;

ALTER TABLE public.adrs
  ADD COLUMN IF NOT EXISTS repository_path TEXT,
  ADD COLUMN IF NOT EXISTS repository_deleted_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS adrs_project_repository_path_idx
  ON public.adrs (project_id, repository_path);

CREATE TABLE IF NOT EXISTS public.github_sync_secrets (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.github_sync_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.github_sync_secrets FROM anon, authenticated;
GRANT ALL ON public.github_sync_secrets TO service_role;
