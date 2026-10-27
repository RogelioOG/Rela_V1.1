/*
# Deduplicate units and enforce unique identifier

1. Deactivate duplicate units (keep the first created, mark the rest inactive)
2. Create the unique index on (organization_id, unique_identifier) — but only
   for active units, so historical inactive duplicates are allowed.
3. Add the partial unique index for revenue_periods active work period.
*/

-- Deactivate the second unit in each duplicate pair
UPDATE units SET is_active = false
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (PARTITION BY organization_id, unique_identifier ORDER BY created_at ASC) as rn
    FROM units
  ) sub
  WHERE rn > 1
);

-- Unique index only among active units (allows inactive historical duplicates)
DROP INDEX IF EXISTS units_org_unique_identifier_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS units_org_unique_identifier_active_idx
  ON units (organization_id, unique_identifier)
  WHERE is_active = true;

-- Partial unique index: at most one active work period per organization
DROP INDEX IF EXISTS revenue_periods_one_active_work_idx;
CREATE UNIQUE INDEX IF NOT EXISTS revenue_periods_one_active_work_idx
  ON revenue_periods (organization_id)
  WHERE is_work_period_active = true;
