-- Migration: Sync usernames across public.profiles and public.local_users
-- Ensures username login works for accounts created before or without local_users.username

-- 1. Copy usernames from profiles into local_users where missing
UPDATE public.local_users lu
SET username = LOWER(TRIM(p.username))
FROM public.profiles p
WHERE lu.id = p.id
  AND lu.username IS NULL
  AND p.username IS NOT NULL;

-- 2. Copy usernames from local_users into profiles where missing
UPDATE public.profiles p
SET username = LOWER(TRIM(lu.username))
FROM public.local_users lu
WHERE p.id = lu.id
  AND p.username IS NULL
  AND lu.username IS NOT NULL;

-- 3. For decyra_admin bootstrap user with missing username, set it to decyra_admin
UPDATE public.local_users
SET username = 'decyra_admin'
WHERE email = 'decyra_admin' AND username IS NULL;

UPDATE public.profiles
SET username = 'decyra_admin'
WHERE email = 'decyra_admin' AND username IS NULL;
