/*
# Add credit_term_days to invoices & fix user_organizations RLS

## Changes
1. Add `credit_term_days` integer column to `invoices` table (nullable, for credit/fiado sales)
2. Fix RLS on `user_organizations` so org admins can insert/update/delete records
   for users within their own organization. Currently only master or self-insert works.
3. Add a helper function `is_org_admin_of(org_id)` for cleaner policy predicates.

## Security
- user_organizations: org admins (users with role='admin' in the same org) can now
  INSERT, UPDATE, and DELETE membership rows for their organization.
- This allows org admins to create and manage internal users (collaborators).
*/

-- Add credit_term_days column
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credit_term_days integer DEFAULT NULL;

-- Helper: check if current user is admin of a given org
CREATE OR REPLACE FUNCTION public.is_org_admin_of(org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_master_user()
  OR EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid()
      AND uo.organization_id = org_id
      AND uo.role = 'admin'
  )
$$;

-- Fix user_organizations RLS: allow org admins to manage memberships
-- Drop existing policies and recreate with org-admin support

DROP POLICY IF EXISTS "uo_select" ON user_organizations;
CREATE POLICY "uo_select" ON user_organizations FOR SELECT
  TO authenticated
  USING (
    public.is_master_user()
    OR EXISTS (
      SELECT 1 FROM public.user_organizations uo2
      WHERE uo2.user_id = auth.uid()
        AND uo2.organization_id = user_organizations.organization_id
    )
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "uo_insert" ON user_organizations;
CREATE POLICY "uo_insert" ON user_organizations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_master_user()
    OR public.is_org_admin_of(organization_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "uo_update" ON user_organizations;
CREATE POLICY "uo_update" ON user_organizations FOR UPDATE
  TO authenticated
  USING (
    public.is_master_user()
    OR public.is_org_admin_of(organization_id)
  )
  WITH CHECK (
    public.is_master_user()
    OR public.is_org_admin_of(organization_id)
  );

DROP POLICY IF EXISTS "uo_delete" ON user_organizations;
CREATE POLICY "uo_delete" ON user_organizations FOR DELETE
  TO authenticated
  USING (
    public.is_master_user()
    OR public.is_org_admin_of(organization_id)
    OR user_id = auth.uid()
  );