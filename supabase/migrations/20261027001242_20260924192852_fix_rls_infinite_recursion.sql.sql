/*
# Fix RLS Infinite Recursion on profiles (error 42P17)

## Problema
Las políticas RLS en `profiles`, `organizations` y `user_organizations`
consultaban `profiles` para verificar si el usuario era master:
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master')
Esto activa RLS en `profiles` nuevamente, creando una recursión infinita
que produce el error 42P17 (infinite recursion detected in policy).

## Solución
1. Crear una función `SECURITY DEFINER` `is_master_user()` que lee el rol
   del usuario directamente desde `profiles` SIN activar RLS (porque
   `SECURITY DEFINER` ejecuta con los privilegios del propietario).
2. Reescribir todas las políticas que consultaban `profiles` para usar
   `public.is_master_user()` en su lugar.
3. La política SELECT en `profiles` se simplifica: el usuario siempre puede
   ver su propio perfil (auth.uid() = id), y el master puede ver todos
   (is_master_user()).

## Cambios
- Nueva función: `public.is_master_user()` → boolean
- Políticas reescritas en: profiles, organizations, user_organizations
- Sin cambios en la estructura de tablas
*/

-- ============================================================
-- FUNCIÓN: is_master_user() — Lee el rol sin activar RLS
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_master_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'master'
  )
$$;

-- ============================================================
-- REESCRIBIR POLÍTICAS: profiles
-- ============================================================

-- profiles: SELECT (propio perfil o master)
DROP POLICY IF EXISTS "profiles_select_own_or_master" ON profiles;
CREATE POLICY "profiles_select_own_or_master"
ON profiles FOR SELECT
TO authenticated
USING (
  auth.uid() = id OR public.is_master_user()
);

-- profiles: INSERT (solo master)
DROP POLICY IF EXISTS "profiles_insert_master_only" ON profiles;
CREATE POLICY "profiles_insert_master_only"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (public.is_master_user());

-- profiles: UPDATE (propio perfil o master)
DROP POLICY IF EXISTS "profiles_update_own_or_master" ON profiles;
CREATE POLICY "profiles_update_own_or_master"
ON profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id OR public.is_master_user())
WITH CHECK (auth.uid() = id OR public.is_master_user());

-- profiles: DELETE (solo master)
DROP POLICY IF EXISTS "profiles_delete_master_only" ON profiles;
CREATE POLICY "profiles_delete_master_only"
ON profiles FOR DELETE
TO authenticated
USING (public.is_master_user());

-- ============================================================
-- REESCRIBIR POLÍTICAS: organizations
-- ============================================================

DROP POLICY IF EXISTS "orgs_select_own_or_master" ON organizations;
CREATE POLICY "orgs_select_own_or_master"
ON organizations FOR SELECT
TO authenticated
USING (
  public.is_master_user()
  OR EXISTS (
    SELECT 1 FROM user_organizations uo
    WHERE uo.user_id = auth.uid() AND uo.organization_id = organizations.id
  )
);

DROP POLICY IF EXISTS "orgs_insert_master_only" ON organizations;
CREATE POLICY "orgs_insert_master_only"
ON organizations FOR INSERT
TO authenticated
WITH CHECK (public.is_master_user());

DROP POLICY IF EXISTS "orgs_update_master_only" ON organizations;
CREATE POLICY "orgs_update_master_only"
ON organizations FOR UPDATE
TO authenticated
USING (public.is_master_user())
WITH CHECK (public.is_master_user());

DROP POLICY IF EXISTS "orgs_delete_master_only" ON organizations;
CREATE POLICY "orgs_delete_master_only"
ON organizations FOR DELETE
TO authenticated
USING (public.is_master_user());

-- ============================================================
-- REESCRIBIR POLÍTICAS: user_organizations
-- ============================================================

DROP POLICY IF EXISTS "user_orgs_select_own_or_master" ON user_organizations;
CREATE POLICY "user_orgs_select_own_or_master"
ON user_organizations FOR SELECT
TO authenticated
USING (
  user_id = auth.uid() OR public.is_master_user()
);

DROP POLICY IF EXISTS "user_orgs_insert_master_only" ON user_organizations;
CREATE POLICY "user_orgs_insert_master_only"
ON user_organizations FOR INSERT
TO authenticated
WITH CHECK (public.is_master_user());

DROP POLICY IF EXISTS "user_orgs_update_master_only" ON user_organizations;
CREATE POLICY "user_orgs_update_master_only"
ON user_organizations FOR UPDATE
TO authenticated
USING (public.is_master_user())
WITH CHECK (public.is_master_user());

DROP POLICY IF EXISTS "user_orgs_delete_master_only" ON user_organizations;
CREATE POLICY "user_orgs_delete_master_only"
ON user_organizations FOR DELETE
TO authenticated
USING (public.is_master_user());