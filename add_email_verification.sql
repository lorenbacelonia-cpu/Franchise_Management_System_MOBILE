-- ==============================================================================
-- ADD EMAIL VERIFICATION COLUMNS FOR MOBILE ENFORCERS & PASSENGERS
-- Execute this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ynyjkwcjjfswcfzwgumv/sql
-- ==============================================================================

-- 1. Add email and email_verified columns to account_enforcer_mobile (if not yet added)
ALTER TABLE IF EXISTS public.account_enforcer_mobile
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

-- 2. Add email and email_verified columns to account_passenger_mobile (if not yet added)
ALTER TABLE IF EXISTS public.account_passenger_mobile
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

-- 3. Create case-insensitive indices for fast login & duplicate email lookups
CREATE INDEX IF NOT EXISTS idx_account_enforcer_email 
  ON public.account_enforcer_mobile (LOWER(email));

CREATE INDEX IF NOT EXISTS idx_account_passenger_email 
  ON public.account_passenger_mobile (LOWER(email));

-- 4. Ensure RLS remains disabled & full access permissions granted to anon / mobile clients
ALTER TABLE IF EXISTS public.account_enforcer_mobile DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.account_passenger_mobile DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.account_enforcer_mobile TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.account_passenger_mobile TO anon, authenticated, service_role;

-- 5. Seed default emails for existing default accounts (optional convenience)
UPDATE public.account_enforcer_mobile
  SET email = 'enforcer@trd.tabacocity.gov.ph', email_verified = TRUE
  WHERE LOWER(username) = 'enforcer' AND (email IS NULL OR email = '');

UPDATE public.account_enforcer_mobile
  SET email = 'andrie@trd.tabacocity.gov.ph', email_verified = TRUE
  WHERE LOWER(username) = 'andrie' AND (email IS NULL OR email = '');

UPDATE public.account_enforcer_mobile
  SET email = 'admin@trd.tabacocity.gov.ph', email_verified = TRUE
  WHERE LOWER(username) = 'admin' AND (email IS NULL OR email = '');

UPDATE public.account_passenger_mobile
  SET email = 'passenger@gmail.com', email_verified = TRUE
  WHERE LOWER(username) = 'passenger' AND (email IS NULL OR email = '');

UPDATE public.account_passenger_mobile
  SET email = 'pedro@gmail.com', email_verified = TRUE
  WHERE LOWER(username) = 'pedro' AND (email IS NULL OR email = '');

