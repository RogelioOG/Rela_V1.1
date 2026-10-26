/*
# Fix RLS Infinite Recursion on user_organizations and organizations

## Problem
The SELECT policies on `organizations` and `user_organizations` contain inline
subqueries that read from `user_organizations` directly. Because RLS is enabled
on `user_organizations`, Postgres re-evaluates the policy for each subquery,
creating an infinite recursion (error 42P17).

Additionally, duplicate policies exist from the earlier migration
(add_credit_term_and_fix_org_admin_rls) — both the old `user_orgs_*` policies
and the new `uo_*` policies are active simultaneously.

## Solution
1. Create a new SECURITY DEFINER function `has_org_membership(org_id)` that
   checks if the current user belongs to an org (any role), bypassing RLS.
2. Replace ALL inline subqueries against `user_organizations` in policy
   definitions with calls to `has_org_membership()` or `is_org_admin_of()`.
3. Drop all existing policies on `user_organizations` and `organizations`
   and recreate clean, non-recursive versions.
4. Ensure no duplicate policies remain.
*/

-- ============================================================
-- FUNCTION: has_org_membership(org_id) — Check membership without RLS
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_org_membership(org_id uuid)
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
  )
$$;

-- ============================================================
-- DROP ALL existing policies on user_organizations
-- ============================================================
DROP POLICY IF EXISTS "user_orgs_select_own_or_master" ON user_organizations;
DROP POLICY IF EXISTS "user_orgs_insert_master_only" ON user_organizations;
DROP POLICY IF EXISTS "user_orgs_update_master_only" ON user_organizations;
DROP POLICY IF EXISTS "user_orgs_delete_master_only" ON user_organizations;
DROP POLICY IF EXISTS "uo_select" ON user_organizations;
DROP POLICY IF EXISTS "uo_insert" ON user_organizations;
DROP POLICY IF EXISTS "uo_update" ON user_organizations;
DROP POLICY IF EXISTS "uo_delete" ON user_organizations;

-- ============================================================
-- RECREATE user_organizations policies (no self-referencing subqueries)
-- ============================================================

-- SELECT: master, or self (own row), or member of the same org
-- Uses has_org_membership() (SECURITY DEFINER) to avoid recursion
CREATE POLICY "uo_select" ON user_organizations FOR SELECT
  TO authenticated
  USING (
    public.is_master_user()
    OR user_id = auth.uid()
    OR public.has_org_membership(organization_id)
  );

-- INSERT: master, or org admin of the target org, or self-assign
CREATE POLICY "uo_insert" ON user_organizations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_master_user()
    OR public.is_org_admin_of(organization_id)
    OR user_id = auth.uid()
  );

-- UPDATE: master, or org admin of the target org
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

-- DELETE: master, or org admin of the target org, or self-remove
CREATE POLICY "uo_delete" ON user_organizations FOR DELETE
  TO authenticated
  USING (
    public.is_master_user()
    OR public.is_org_admin_of(organization_id)
    OR user_id = auth.uid()
  );

-- ============================================================
-- DROP ALL existing policies on organizations
-- ============================================================
DROP POLICY IF EXISTS "orgs_select_own_or_master" ON organizations;
DROP POLICY IF EXISTS "orgs_insert_master_only" ON organizations;
DROP POLICY IF EXISTS "orgs_update_master_only" ON organizations;
DROP POLICY IF EXISTS "orgs_delete_master_only" ON organizations;

-- ============================================================
-- RECREATE organizations policies (no recursive subqueries)
-- ============================================================

-- SELECT: master, or member of the org
-- Uses has_org_membership() (SECURITY DEFINER) instead of inline subquery
CREATE POLICY "orgs_select" ON organizations FOR SELECT
  TO authenticated
  USING (
    public.is_master_user()
    OR public.has_org_membership(organizations.id)
  );

-- INSERT: master only
CREATE POLICY "orgs_insert" ON organizations FOR INSERT
  TO authenticated
  WITH CHECK (public.is_master_user());

-- UPDATE: master only
CREATE POLICY "orgs_update" ON organizations FOR UPDATE
  TO authenticated
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- DELETE: master only
CREATE POLICY "orgs_delete" ON organizations FOR DELETE
  TO authenticated
  USING (public.is_master_user());

-- ============================================================
-- Verify no duplicate policies remain
-- ============================================================
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('user_organizations', 'organizations')
    AND policyname IN (
      'user_orgs_select_own_or_master', 'user_orgs_insert_master_only',
      'user_orgs_update_master_only', 'user_orgs_delete_master_only',
      'orgs_select_own_or_master', 'orgs_insert_master_only',
      'orgs_update_master_only', 'orgs_delete_master_only'
    );
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Duplicate policies still exist: %', dup_count;
  END IF;
END $$;
