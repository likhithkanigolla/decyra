-- Add recovery_key_hash to local_users table
ALTER TABLE public.local_users ADD COLUMN IF NOT EXISTS recovery_key_hash TEXT;
