/*
# Accounting Periods (Periodos Contables)

## Changes

### 1. New table: `accounting_periods`
- Stores accounting periods per organization (e.g., "Septiembre 2026").
- Each period has: month, year, label, status (open/closed), start_date, end_date, closed_at, closed_by.
- Only one period should be "open" (active) at a time per org, but this is enforced at the application level.
- Periods must be explicitly created — no auto-generation of all months.

### 2. RLS on `accounting_periods`
- Standard 4-policy CRUD scoped to `has_org_access(organization_id)`, TO authenticated.

### 3. Helper function: `is_period_closed(p_org_id, p_date)`
- Returns boolean: whether the given date falls within a closed accounting period.
- Used by the frontend to block manual entry creation in closed periods.

### 4. No changes to existing tables or triggers.

## Important Notes
- Periods are org-scoped. Each org manages its own periods independently.
- A period's start_date is the first day of the month, end_date is the last day.
- When a period is closed (cierre de periodo), users can still view all data for that month but cannot create new manual entries dated within it.
- The frontend checks `is_period_closed` before allowing entry creation/editing.
*/

CREATE TABLE IF NOT EXISTS accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  closed_at timestamptz,
  closed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, month, year)
);

ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ap_select_org" ON accounting_periods;
CREATE POLICY "ap_select_org" ON accounting_periods FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id));

DROP POLICY IF EXISTS "ap_insert_org" ON accounting_periods;
CREATE POLICY "ap_insert_org" ON accounting_periods FOR INSERT TO authenticated
  WITH CHECK (public.has_org_access(organization_id));

DROP POLICY IF EXISTS "ap_update_org" ON accounting_periods;
CREATE POLICY "ap_update_org" ON accounting_periods FOR UPDATE TO authenticated
  USING (public.has_org_access(organization_id))
  WITH CHECK (public.has_org_access(organization_id));

DROP POLICY IF EXISTS "ap_delete_org" ON accounting_periods;
CREATE POLICY "ap_delete_org" ON accounting_periods FOR DELETE TO authenticated
  USING (public.has_org_access(organization_id));

CREATE INDEX IF NOT EXISTS idx_ap_org ON accounting_periods(organization_id);

CREATE OR REPLACE FUNCTION public.is_period_closed(p_org_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.accounting_periods
    WHERE organization_id = p_org_id
      AND status = 'closed'
      AND p_date >= start_date
      AND p_date <= end_date
  );
$$;