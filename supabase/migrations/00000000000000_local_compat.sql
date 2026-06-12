-- =============================================================================
-- LOCAL POSTGRES COMPATIBILITY SHIM
-- This file runs FIRST (timestamp 00000000) and only in local PostgreSQL mode.
-- It creates the `auth` schema + `auth.users` stub table so the main migration
-- (which was written for Supabase) can run without any modifications.
-- =============================================================================

-- Create the auth schema (Supabase has this built-in, local Postgres does not)
CREATE SCHEMA IF NOT EXISTS auth;

-- Create a minimal auth.users stub that mirrors what Supabase provides.
-- The main migration references: auth.users(id), NEW.email, NEW.raw_user_meta_data
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  encrypted_password TEXT,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- auth.uid() function — used in RLS policies (returns NULL in local mode, RLS is disabled anyway)
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$
  SELECT NULL::UUID
$$;

-- Grant permissions so the main migration's GRANT statements don't fail
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END
$$;

-- =============================================================================
-- LOCAL USERS TABLE (for local auth with hashed passwords)
-- This lives in public schema alongside the other app tables.
-- In Supabase mode this table is never used; Supabase manages auth.users.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.local_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 'admin' | 'member'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
