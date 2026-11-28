-- ==============================================================================
-- TABACO CITY TRD - DEDICATED DRIVER PHOTO DATABASE SETUP
-- ==============================================================================
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ynyjkwcjjfswcfzwgumv/sql
--
-- This script:
-- 1. Adds dedicated `driver_photo` TEXT columns to master franchise tables
-- 2. Adds `driver_photo` to system QR code tables
-- 3. Creates an optimized dedicated `driver_photos` registry table
-- 4. Automatically backfills existing driver photos from `fare_matrix` JSON
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ADD DEDICATED DRIVER_PHOTO COLUMN TO MASTER FRANCHISE RECORDS
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS franchise_records_tricycle_admin 
ADD COLUMN IF NOT EXISTS driver_photo TEXT;

ALTER TABLE IF EXISTS franchise_records_pedicab_admin 
ADD COLUMN IF NOT EXISTS driver_photo TEXT;

-- ------------------------------------------------------------------------------
-- 2. ADD DRIVER_PHOTO COLUMN TO SYSTEM QR CODES
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS system_qr_codes_tricycle_admin 
ADD COLUMN IF NOT EXISTS driver_photo TEXT;

ALTER TABLE IF EXISTS system_qr_codes_pedicab_admin 
ADD COLUMN IF NOT EXISTS driver_photo TEXT;

-- ------------------------------------------------------------------------------
-- 3. CREATE DEDICATED DRIVER_PHOTOS REGISTRY TABLE (FAST LOOKUP BY PLATE / MTOP)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_plate_number TEXT NOT NULL,
    mtop_number TEXT,
    driver_name TEXT,
    vehicle_category TEXT DEFAULT 'Tricycle',
    driver_photo TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create fast lookup index on plate and MTOP
CREATE INDEX IF NOT EXISTS idx_driver_photos_plate ON driver_photos(city_plate_number);
CREATE INDEX IF NOT EXISTS idx_driver_photos_mtop ON driver_photos(mtop_number);

-- Enable Row Level Security (RLS)
ALTER TABLE driver_photos ENABLE ROW LEVEL SECURITY;

-- Allow public read access so passenger & enforcer mobile scanner instantly gets the photo
DROP POLICY IF EXISTS "Public Read Driver Photos" ON driver_photos;
CREATE POLICY "Public Read Driver Photos"
ON driver_photos FOR SELECT
TO anon, authenticated
USING (true);

-- Allow authenticated and anon inserts/updates from TRD Admin Portal
DROP POLICY IF EXISTS "Admin Manage Driver Photos" ON driver_photos;
CREATE POLICY "Admin Manage Driver Photos"
ON driver_photos FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 4. AUTOMATIC DATA MIGRATION: EXTRACT AND MIGRATE EXISTING PHOTOS
-- ------------------------------------------------------------------------------
-- Backfill Tricycle master records
UPDATE franchise_records_tricycle_admin
SET driver_photo = (
    SELECT elem->>'photo'
    FROM jsonb_array_elements(
        CASE 
            WHEN jsonb_typeof(fare_matrix::jsonb) = 'array' THEN fare_matrix::jsonb
            ELSE '[]'::jsonb
        END
    ) AS elem
    WHERE elem->>'destination' = 'DRIVER_PHOTO' OR elem->>'id' = '__driver_photo__'
    LIMIT 1
)
WHERE (driver_photo IS NULL OR driver_photo = '') AND fare_matrix IS NOT NULL;

-- Backfill Pedicab master records
UPDATE franchise_records_pedicab_admin
SET driver_photo = (
    SELECT elem->>'photo'
    FROM jsonb_array_elements(
        CASE 
            WHEN jsonb_typeof(fare_matrix::jsonb) = 'array' THEN fare_matrix::jsonb
            ELSE '[]'::jsonb
        END
    ) AS elem
    WHERE elem->>'destination' = 'DRIVER_PHOTO' OR elem->>'id' = '__driver_photo__'
    LIMIT 1
)
WHERE (driver_photo IS NULL OR driver_photo = '') AND fare_matrix IS NOT NULL;

-- Backfill into the dedicated driver_photos table from Tricycle records
INSERT INTO driver_photos (city_plate_number, mtop_number, driver_name, vehicle_category, driver_photo)
SELECT 
    city_plate_number, 
    mtop_number, 
    driver_name, 
    'Tricycle', 
    driver_photo
FROM franchise_records_tricycle_admin
WHERE driver_photo IS NOT NULL AND driver_photo <> ''
ON CONFLICT (id) DO NOTHING;

-- Backfill into the dedicated driver_photos table from Pedicab records
INSERT INTO driver_photos (city_plate_number, mtop_number, driver_name, vehicle_category, driver_photo)
SELECT 
    city_plate_number, 
    mtop_number, 
    driver_name, 
    'Pedicab', 
    driver_photo
FROM franchise_records_pedicab_admin
WHERE driver_photo IS NOT NULL AND driver_photo <> ''
ON CONFLICT (id) DO NOTHING;
