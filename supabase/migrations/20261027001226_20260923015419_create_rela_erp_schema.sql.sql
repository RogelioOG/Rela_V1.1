/*
# Rela ERP — Esquema Inicial de Base de Datos

## Descripción
Crea el esquema relacional completo para Rela ERP, un sistema SaaS de gestión
para organizaciones (negocios, tiendas, supermercados y propiedades residenciales).

## Tablas Nuevas

### 1. `profiles` (Perfiles de Usuario)
- `id` (uuid, PK) — Referencia a `auth.users.id`
- `email` (text, unique, not null) — Correo electrónico
- `full_name` (text) — Nombre completo del usuario
- `role` (text, not null, default 'user') — Rol: 'master', 'admin', 'user'
- `is_active` (boolean, default true) — Usuario activo/inactivo
- `created_at` / `updated_at` (timestamptz)

### 2. `organizations` (Organizaciones / Negocios)
- `id` (uuid, PK)
- `name` (text, not null) — Nombre
- `type` (text, not null) — Tipo: 'tienda', 'supermercado', 'residencial', 'otro'
- `nit` (text, unique) — NIT
- `address`, `phone`, `email`, `city` (text)
- `is_active` (boolean, default true)
- `created_at` / `updated_at`

### 3. `user_organizations` (Asociación Usuario-Organización)
- `id` (uuid, PK)
- `user_id` (uuid, FK → profiles.id)
- `organization_id` (uuid, FK → organizations.id)
- `role` (text, not null, default 'user') — Rol: 'admin', 'user'
- `created_at`

## Seguridad (RLS)
- profiles: ver/actualizar propio perfil o ser master; insert/delete solo master
- organizations: ver propias o ser master; CRUD solo master
- user_organizations: ver propias o ser master; CRUD solo master

## Notas
1. El usuario master se crea mediante trigger al registrarse en auth.users.
2. role en profiles = acceso global; role en user_organizations = rol dentro de organización.
3. RLS habilitado en todas las tablas.
*/

-- ============================================================
-- TABLAS (sin políticas que referencian tablas aún no creadas)
-- ============================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text DEFAULT '',
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('master', 'admin', 'user')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'tienda' CHECK (type IN ('tienda', 'supermercado', 'residencial', 'otro')),
  nit text UNIQUE,
  address text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  city text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;

-- profiles: SELECT
DROP POLICY IF EXISTS "profiles_select_own_or_master" ON profiles;
CREATE POLICY "profiles_select_own_or_master"
ON profiles FOR SELECT
TO authenticated
USING (
  auth.uid() = id
  OR EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
);

-- profiles: INSERT (solo master)
DROP POLICY IF EXISTS "profiles_insert_master_only" ON profiles;
CREATE POLICY "profiles_insert_master_only"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
);

-- profiles: UPDATE (propio perfil o master)
DROP POLICY IF EXISTS "profiles_update_own_or_master" ON profiles;
CREATE POLICY "profiles_update_own_or_master"
ON profiles FOR UPDATE
TO authenticated
USING (
  auth.uid() = id
  OR EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
)
WITH CHECK (
  auth.uid() = id
  OR EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
);

-- profiles: DELETE (solo master)
DROP POLICY IF EXISTS "profiles_delete_master_only" ON profiles;
CREATE POLICY "profiles_delete_master_only"
ON profiles FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
);

-- organizations: SELECT (propias o master)
DROP POLICY IF EXISTS "orgs_select_own_or_master" ON organizations;
CREATE POLICY "orgs_select_own_or_master"
ON organizations FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
  OR EXISTS (
    SELECT 1 FROM user_organizations uo
    WHERE uo.user_id = auth.uid() AND uo.organization_id = organizations.id
  )
);

-- organizations: INSERT (solo master)
DROP POLICY IF EXISTS "orgs_insert_master_only" ON organizations;
CREATE POLICY "orgs_insert_master_only"
ON organizations FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
);

-- organizations: UPDATE (solo master)
DROP POLICY IF EXISTS "orgs_update_master_only" ON organizations;
CREATE POLICY "orgs_update_master_only"
ON organizations FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
);

-- organizations: DELETE (solo master)
DROP POLICY IF EXISTS "orgs_delete_master_only" ON organizations;
CREATE POLICY "orgs_delete_master_only"
ON organizations FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
);

-- user_organizations: SELECT (propias o master)
DROP POLICY IF EXISTS "user_orgs_select_own_or_master" ON user_organizations;
CREATE POLICY "user_orgs_select_own_or_master"
ON user_organizations FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
);

-- user_organizations: INSERT (solo master)
DROP POLICY IF EXISTS "user_orgs_insert_master_only" ON user_organizations;
CREATE POLICY "user_orgs_insert_master_only"
ON user_organizations FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
);

-- user_organizations: UPDATE (solo master)
DROP POLICY IF EXISTS "user_orgs_update_master_only" ON user_organizations;
CREATE POLICY "user_orgs_update_master_only"
ON user_organizations FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
);

-- user_organizations: DELETE (solo master)
DROP POLICY IF EXISTS "user_orgs_delete_master_only" ON user_organizations;
CREATE POLICY "user_orgs_delete_master_only"
ON user_organizations FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
  )
);

-- ============================================================
-- TRIGGER: Crear perfil automáticamente al registrarse un usuario
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- FUNCIÓN: Actualizar updated_at automáticamente
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS organizations_updated_at ON organizations;
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(type);
CREATE INDEX IF NOT EXISTS idx_organizations_active ON organizations(is_active);
CREATE INDEX IF NOT EXISTS idx_user_orgs_user_id ON user_organizations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_orgs_org_id ON user_organizations(organization_id);