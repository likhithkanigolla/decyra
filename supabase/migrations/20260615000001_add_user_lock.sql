-- Add is_locked column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;
