-- Add graph_layout column to projects for persisting graph viewer node coordinates
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS graph_layout JSONB DEFAULT '{}'::jsonb;
