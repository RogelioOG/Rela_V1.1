/*
# Cuotas de Administración — History Support

## Purpose
Allow multiple quota configuration records per (organization, period, concept) so that
every saved configuration is preserved as history. Only the most recent record per
combination should be active (is_active = true).

## Changes
1. Drop the UNIQUE constraint on admin_quotas(organization_id, revenue_period_id, billing_concept_id)
   so that multiple records can coexist (history).
2. Add a partial unique index on (organization_id, revenue_period_id, billing_concept_id)
   WHERE is_active = true, ensuring only one active record per combination.
3. No new tables needed — the existing admin_quotas table now stores history rows.
4. No RLS changes — existing policies already use has_org_access(organization_id).

## Important notes
- Existing data: any existing rows remain. If there are duplicates after dropping
  the constraint, the partial unique index only applies to is_active=true rows,
  so historical (is_active=false) rows do not conflict.
- The application is responsible for setting is_active=false on the previous record
  before inserting a new active one.
*/

-- Step 1: Drop the existing unique constraint
ALTER TABLE public.admin_quotas DROP CONSTRAINT IF EXISTS admin_quotas_organization_id_revenue_period_id_billing_concept_i_key;

-- Step 2: Add partial unique index for active records only
CREATE UNIQUE INDEX IF NOT EXISTS admin_quotas_active_unique_idx
  ON public.admin_quotas (organization_id, revenue_period_id, billing_concept_id)
  WHERE is_active = true;
