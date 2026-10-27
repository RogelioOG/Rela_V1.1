/*
# Structural enhancements: add columns (step 1 — no constraints yet)

Adds columns to units, billing_concepts, and revenue_periods.
Unique indexes will be added in a follow-up migration after data cleanup.
*/

-- 1. Units unique identifier (generated, no index yet)
ALTER TABLE units ADD COLUMN IF NOT EXISTS unique_identifier text
  GENERATED ALWAYS AS (COALESCE(UPPER(TRIM(tower)) || '-', '') || UPPER(TRIM(unit_label))) STORED;

-- 2. Billing concepts flags
ALTER TABLE billing_concepts ADD COLUMN IF NOT EXISTS causa_intereses boolean NOT NULL DEFAULT true;
ALTER TABLE billing_concepts ADD COLUMN IF NOT EXISTS maneja_descuento boolean NOT NULL DEFAULT false;

-- 3. Revenue periods work period
ALTER TABLE revenue_periods ADD COLUMN IF NOT EXISTS work_month integer CHECK (work_month IS NULL OR (work_month >= 1 AND work_month <= 12));
ALTER TABLE revenue_periods ADD COLUMN IF NOT EXISTS work_year integer;
ALTER TABLE revenue_periods ADD COLUMN IF NOT EXISTS is_work_period_active boolean NOT NULL DEFAULT false;
