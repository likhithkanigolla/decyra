-- Run this script to create the first admin user in local Postgres mode.
-- Replace the values in the SET block below before running.

DO $$
DECLARE
  v_email     TEXT    := 'admin@example.com';   -- CHANGE THIS
  v_password  TEXT    := 'changeme123';          -- CHANGE THIS (min 8 chars)
  v_fullname  TEXT    := 'Platform Admin';       -- CHANGE THIS
  v_user_id   UUID    := gen_random_uuid();
  v_salt      TEXT;
  v_hash      TEXT;
BEGIN
  -- NOTE: This uses a plain bcrypt-style placeholder.
  -- Since we use Node crypto (PBKDF2) for hashing, you should use
  -- Option 2 (the npm script) for proper password hashing.
  -- This script sets a KNOWN placeholder hash that won't work for login.
  -- Use it only to bootstrap, then reset password via the admin UI.
  RAISE EXCEPTION 'Use Option 2 (npm run create-admin) for proper password hashing. See scripts/create-admin.ts';
END $$;
