-- =============================================================================
-- LOCAL POSTGRES POST-SETUP
-- This runs AFTER the main migration (higher timestamp).
-- It disables the Supabase-specific trigger that auto-creates profiles
-- on auth.users insert. In local mode, our createLocalUser() handles this
-- manually, so the trigger would cause duplicate-key errors.
-- =============================================================================

-- Drop the auth trigger (only exists after the main migration created it)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Keep the function around in case it's needed for debugging, but make it a no-op
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Disabled in local mode; user creation is handled by local-auth.server.ts
  RETURN NEW;
END; $$;
