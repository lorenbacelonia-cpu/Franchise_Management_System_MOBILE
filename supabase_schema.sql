-- ==============================================================================
-- TABACO CITY TRD FRANCHISE MANAGEMENT SYSTEM - MOBILE DATABASE SCHEMA
-- Handles Mobile Accounts (Enforcers & Passengers) and Reports/Complaints
-- (Franchise Records are managed directly by the TRD Admin System)
-- ==============================================================================

-- 1. DROP PREVIOUS MOBILE TABLES IF NEEDED
DROP TABLE IF EXISTS passenger_complaints CASCADE;
DROP TABLE IF EXISTS account_enforcer_mobile CASCADE;
DROP TABLE IF EXISTS account_passenger_mobile CASCADE;

-- 2. CREATE TABLE: account_enforcer_mobile
-- Stores strictly: username, fullname, password
CREATE TABLE public.account_enforcer_mobile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  fullname TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. CREATE TABLE: account_passenger_mobile
-- Stores strictly: username, fullname, password
CREATE TABLE public.account_passenger_mobile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  fullname TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. CREATE TABLE: passenger_complaints
-- Records passenger overcharging reports and enforcer traffic citations
CREATE TABLE public.passenger_complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_name TEXT NOT NULL,
  reporter_role TEXT NOT NULL DEFAULT 'Passenger',
  report_type TEXT NOT NULL,
  plate_no TEXT NOT NULL,
  vehicle_type TEXT DEFAULT 'Pedicab',
  driver_name TEXT,
  actual_fare NUMERIC,
  enforcer_badge TEXT,
  citation_no TEXT,
  remarks TEXT,
  status TEXT DEFAULT 'Pending Review',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================================================
-- PERMISSIONS / ROW LEVEL SECURITY (RLS)
-- Disabling RLS allows the mobile web app to write (sign up) and read (log in)
-- without 401 Unauthorized / RLS 42501 errors.
-- ==============================================================================

ALTER TABLE public.account_enforcer_mobile DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_passenger_mobile DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.passenger_complaints DISABLE ROW LEVEL SECURITY;

-- Grant standard permissions to anon and authenticated roles
GRANT ALL ON TABLE public.account_enforcer_mobile TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.account_passenger_mobile TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.passenger_complaints TO anon, authenticated, service_role;

-- ==============================================================================
-- INITIAL SEED DATA
-- Default accounts for mobile testing
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

-- Seed Official Pedicab Franchise Records
INSERT INTO public.franchise_records (plate_no, operator, driver, route, vehicle_type, expiry, tourist_guide, availability, status) VALUES
  ('1243', 'Andrie B. Barasona', 'Salvador B. Bacelonia', 'Sua-Igot 24 Tabaco', 'Pedicab', '2026-12-31', true, 'Available', 'Active'),
  ('0821', 'Carlos Mendoza', 'Rogelio Alcantara', 'Centro - Fatima Route', 'Pedicab', '2026-12-31', true, 'Available', 'Active'),
  ('0455', 'Elena Ramirez', 'Danilo Gomez', 'San Roque - Divisoria', 'Pedicab', '2026-12-31', false, 'Available', 'Active'),
  ('0932', 'Roberto Tan', 'Nestor Cruz', 'Tabaco Public Market - Tagas', 'Pedicab', '2026-12-31', true, 'Available', 'Active')
ON CONFLICT (plate_no) DO NOTHING;

-- Seed Official Tricycle Franchise Records
INSERT INTO public.franchise_records (plate_no, operator, driver, route, vehicle_type, expiry, tourist_guide, availability, status) VALUES
  ('5521', 'Tabaco Tricycle Operators Corp', 'Eduardo Ramos', 'Sua-Igot to BTC / Tabaco', 'Tricycle', '2026-12-31', true, 'Available', 'Active'),
  ('7710', 'Bicol Transport Coop', 'Felipe Santos', 'Centro to Oras Terminal', 'Tricycle', '2026-12-31', false, 'Available', 'Active'),
  ('3319', 'Mayon TODA Association', 'Arnel Bautista', 'San Carlos - Pawa Route', 'Tricycle', '2026-12-31', true, 'Available', 'Active')
ON CONFLICT (plate_no) DO NOTHING;
