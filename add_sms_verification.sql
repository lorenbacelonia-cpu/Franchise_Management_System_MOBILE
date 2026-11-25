-- ==============================================================================
-- ADD SMS VERIFICATION (TEXTBEE) & PHONE COLUMNS FOR MOBILE CITIZENS & ENFORCERS
-- Execute this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ynyjkwcjjfswcfzwgumv/sql
-- ==============================================================================

-- 1. Add contact_number and phone_verified columns to account_passenger_mobile
ALTER TABLE IF EXISTS public.account_passenger_mobile
  ADD COLUMN IF NOT EXISTS contact_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email VARCHAR(150),
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

-- 2. Add contact_number and phone_verified columns to account_enforcer_mobile
ALTER TABLE IF EXISTS public.account_enforcer_mobile
  ADD COLUMN IF NOT EXISTS contact_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email VARCHAR(150),
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

-- 3. Create case-insensitive indices for fast login & duplicate phone/email lookups
CREATE INDEX IF NOT EXISTS idx_account_passenger_contact 
  ON public.account_passenger_mobile (contact_number);

CREATE INDEX IF NOT EXISTS idx_account_passenger_email 
  ON public.account_passenger_mobile (LOWER(email));

CREATE INDEX IF NOT EXISTS idx_account_enforcer_contact 
  ON public.account_enforcer_mobile (contact_number);

CREATE INDEX IF NOT EXISTS idx_account_enforcer_email 
  ON public.account_enforcer_mobile (LOWER(email));

-- 4. Ensure RLS remains disabled & full access permissions granted to anon / mobile clients
ALTER TABLE IF EXISTS public.account_passenger_mobile DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.account_enforcer_mobile DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.account_passenger_mobile TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.account_enforcer_mobile TO anon, authenticated, service_role;
