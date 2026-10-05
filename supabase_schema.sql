-- ==============================================================================
-- TABACO CITY TRD FRANCHISE MANAGEMENT SYSTEM - MOBILE & REPORTS DATABASE SCHEMA
-- Handles Mobile Accounts (Enforcers & Passengers),
-- SEPARATED Storage for:
-- 1. Traffic Enforcer Violations & Citations (enforcer_violations + violation_attachments)
-- 2. Passenger Overcharging & Reports (passenger_complaints + complaint_attachments)
-- ==============================================================================

-- 1. TABLE: account_enforcer_mobile (Enforcer Authentication)
CREATE TABLE IF NOT EXISTS public.account_enforcer_mobile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  fullname TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. TABLE: account_passenger_mobile (Passenger Authentication)
CREATE TABLE IF NOT EXISTS public.account_passenger_mobile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  fullname TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================================================
-- 3. SEPARATED TABLE FOR TRAFFIC ENFORCERS: enforcer_violations
-- Records official apprehension citations, expired franchise tickets, out-of-line, etc.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.enforcer_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enforcer_name TEXT NOT NULL,
  enforcer_badge TEXT NOT NULL,
  citation_no TEXT,
  city_plate_number TEXT,
  mtop_number TEXT,
  vehicle_category TEXT DEFAULT 'Pedicab',
  driver_name TEXT,
  violation_type TEXT NOT NULL,
  remarks TEXT,
  description TEXT,
  incident_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'Pending TRD Review',
  evidence_image TEXT,        -- Stores PNG / JPEG Base64 or Storage URL
  evidence_filename TEXT,     -- Stores photo filename (e.g. ticket_photo.jpg)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Photo attachments dedicated to enforcer citations
CREATE TABLE IF NOT EXISTS public.violation_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_id UUID REFERENCES public.enforcer_violations(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'image/jpeg',
  file_size INTEGER DEFAULT 0,
  image_data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================================================
-- 4. SEPARATED TABLE FOR PASSENGERS: passenger_complaints
-- Records passenger overcharging, rude behavior, and service complaints.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.passenger_complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complainant_name TEXT NOT NULL,
  city_plate_number TEXT,
  mtop_number TEXT,
  vehicle_category TEXT DEFAULT 'Pedicab',
  driver_name TEXT,
  actual_fare NUMERIC,
  incident_date DATE DEFAULT CURRENT_DATE,
  issue_type TEXT NOT NULL DEFAULT 'Overcharging (Excess Fare)',
  description TEXT,
  status TEXT DEFAULT 'Under Investigation',
  evidence_image TEXT,        -- Stores PNG / JPEG Base64 or Storage URL
  evidence_filename TEXT,     -- Stores photo filename (e.g. fare_receipt.png)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure image columns exist on passenger_complaints if table was already created
ALTER TABLE public.passenger_complaints ADD COLUMN IF NOT EXISTS evidence_image TEXT;
ALTER TABLE public.passenger_complaints ADD COLUMN IF NOT EXISTS evidence_filename TEXT;
ALTER TABLE public.passenger_complaints ADD COLUMN IF NOT EXISTS driver_name TEXT;
ALTER TABLE public.passenger_complaints ADD COLUMN IF NOT EXISTS actual_fare NUMERIC;

-- Photo attachments dedicated to passenger complaints
CREATE TABLE IF NOT EXISTS public.complaint_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID REFERENCES public.passenger_complaints(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'image/jpeg',
  file_size INTEGER DEFAULT 0,
  image_data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) & ACCESS PERMISSIONS
-- ==============================================================================

ALTER TABLE public.account_enforcer_mobile DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_passenger_mobile DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.enforcer_violations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.violation_attachments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.passenger_complaints DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_attachments DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.account_enforcer_mobile TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.account_passenger_mobile TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.enforcer_violations TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.violation_attachments TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.passenger_complaints TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.complaint_attachments TO anon, authenticated, service_role;

-- ==============================================================================
-- INITIAL SEED DATA
-- ==============================================================================

-- Seed Enforcer Accounts
INSERT INTO public.account_enforcer_mobile (username, fullname, password) VALUES
  ('Enforcer', 'Officer Juan Dela Cruz', 'enforcer123'),
  ('Andrie', 'Andrie Barasona', 'andrie123'),
  ('Admin', 'TRD Admin Officer', 'admin123')
ON CONFLICT (username) DO NOTHING;

-- Seed Passenger Accounts
INSERT INTO public.account_passenger_mobile (username, fullname, password) VALUES
  ('Passenger', 'Maria Santos', 'passenger123'),
  ('Pedro', 'Pedro Penduko', 'pedro123')
ON CONFLICT (username) DO NOTHING;
