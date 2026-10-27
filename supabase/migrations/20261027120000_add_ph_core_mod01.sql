/*
# Rela ERP — Módulo PH Core (MOD-01): Inmuebles, Propietarios, Calendario y Conceptos

## Descripción
Implementa la primera fase del módulo de Propiedad Horizontal conforme a la
Ley 675 de 2001 y NIIF para Colombia:
1. Co-propietarios (hasta 2 por inmueble) con documento, razón social y áreas.
2. Calendario de recaudo (periodos de facturación, días de gracia, fechas de
   inicio de intereses de mora, días de desfase y umbrales de descuento).
3. Conceptos de cobro con clasificación de cuentas Reales (Clases 1-6) vs de
   Orden (Clases 8-9) y creación automática de sub-conceptos de intereses de
   mora vinculados a la cuenta contrapartida.

## Tablas Nuevas

### 1. `unit_owners` (Propietarios / Co-propietarios de inmuebles)
- `id` (uuid, PK)
- `organization_id` (uuid, FK → organizations)
- `unit_id` (uuid, FK → units, ON DELETE CASCADE)
- `position` (smallint, 1..2) — orden del copropietario (1 = principal)
- `document_type` (text) — 'CC', 'NIT', 'CE', 'Pasaporte'
- `document_number` (text, not null)
- `first_name` (text) — nombre cuando es persona natural
- `last_name` (text) — apellidos cuando es persona natural
- `business_name` (text) — razón social cuando es persona jurídica
- `email` (text) — opcional
- `phone` (text) — opcional
- `is_primary` (boolean, default true para position 1)
- `created_at` / `updated_at` (timestamptz)
- UNIQUE(unit_id, position) — máximo 2 propietarios por inmueble

### 2. `revenue_periods` (Calendario de Recaudo)
- `id` (uuid, PK)
- `organization_id` (uuid, FK → organizations)
- `name` (text, not null) — etiqueta del periodo (ej: "Mensual 2026")
- `frequency` (text) — 'mensual', 'bimestral', 'trimestral', 'anual'
- `start_date` (date) — fecha de inicio del ciclo
- `end_date` (date) — fecha de fin del ciclo
- `billing_day` (smallint) — día del mes en que se emite el cobro
- `due_day` (smallint) — día límite de pago sin intereses
- `grace_days` (integer, default 0) — días de gracia adicionales
- `offset_days` (integer, default 0) — desfase en días para el vencimiento
- `interest_start_date` (date) — fecha de inicio del devengo de intereses de mora
- `late_interest_rate` (numeric(6,4)) — tasa mensual de intereses de mora
- `discount_threshold_days` (integer, default 0) — días de pago anticipado para descuento
- `discount_rate` (numeric(6,4)) — tasa de descuento por pago anticipado
- `is_active` (boolean, default true)
- `created_at` / `updated_at` (timestamptz)
- UNIQUE(organization_id, name)

### 3. `billing_concepts` (Conceptos de Cobro)
- `id` (uuid, PK)
- `organization_id` (uuid, FK → organizations)
- `code` (text, not null) — código corto (ej: "ADM", "INTMORA")
- `name` (text, not null) — nombre visible (ej: "Cuota de Administración")
- `description` (text)
- `category` (text) — 'administracion', 'extraordinaria', 'penalizacion',
  'reserva', 'fondo', 'servicio', 'otro'
- `account_class` (text, not null) — 'real' (Clases 1-6) o 'orden' (Clases 8/9)
- `income_account_id` (uuid, FK → accounts) — cuenta de ingreso/orden acreedora
- `counterpart_account_id` (uuid, FK → accounts, nullable) — cuenta contrapartida
- `parent_concept_id` (uuid, FK → billing_concepts, nullable) — sub-concepto de
  intereses de mora vinculado a su concepto padre
- `is_late_interest` (boolean, default false) — marca sub-conceptos de mora
- `is_default` (boolean, default false) — "Cuota de Administración" obligatoria
- `is_active` (boolean, default true)
- `created_at` / `updated_at` (timestamptz)
- UNIQUE(organization_id, code)

## Modificaciones a tablas existentes

### `units`
- `payment_reference` (text) — referencia única de pago opcional
- `built_area` (numeric(10,2)) — área construida en m²
- Los campos `owner_name`, `owner_document`, `owner_phone` se conservan por
  compatibilidad hacia atrás; los datos detallados viven en `unit_owners`.

## Seguridad (RLS)
- Todas las tablas nuevas: SELECT/INSERT/UPDATE/DELETE con `has_org_access()`.
- Mismo patrón multi-tenant que el resto del ERP.

## Notas
1. El campo `position` en `unit_owners` garantiza máximo 2 propietarios por
   inmueble mediante la restricción UNIQUE(unit_id, position) y un CHECK.
2. `billing_concepts.account_class` determina el flujo contable: cuentas Reales
   (Clases 1-6 PUC/NIIF) vs de Orden (Clases 8 y 9).
3. Los sub-conceptos de intereses de mora se crean automáticamente con
   `is_late_interest = true` y `parent_concept_id` apuntando al concepto padre,
   con nombre "Intereses de Mora por [Nombre del Concepto]".
4. El concepto "Cuota de Administración" se marca con `is_default = true` y es
   obligatorio para toda organización residencial.
*/

-- ============================================================
-- 1. Extender tabla units
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='units' AND column_name='payment_reference') THEN
    ALTER TABLE public.units ADD COLUMN payment_reference text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='units' AND column_name='built_area') THEN
    ALTER TABLE public.units ADD COLUMN built_area numeric(10,2);
  END IF;
END $$;

-- ============================================================
-- 2. unit_owners
-- ============================================================
CREATE TABLE IF NOT EXISTS public.unit_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  position smallint NOT NULL DEFAULT 1 CHECK (position IN (1, 2)),
  document_type text NOT NULL DEFAULT 'CC' CHECK (document_type IN ('CC', 'NIT', 'CE', 'Pasaporte')),
  document_number text NOT NULL DEFAULT '',
  first_name text DEFAULT '',
  last_name text DEFAULT '',
  business_name text DEFAULT '',
  email text DEFAULT '',
  phone text DEFAULT '',
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(unit_id, position)
);

ALTER TABLE public.unit_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uo_select_org" ON public.unit_owners;
CREATE POLICY "uo_select_org" ON public.unit_owners FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "uo_insert_org" ON public.unit_owners;
CREATE POLICY "uo_insert_org" ON public.unit_owners FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "uo_update_org" ON public.unit_owners;
CREATE POLICY "uo_update_org" ON public.unit_owners FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "uo_delete_org" ON public.unit_owners;
CREATE POLICY "uo_delete_org" ON public.unit_owners FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

CREATE INDEX IF NOT EXISTS idx_uo_org ON public.unit_owners(organization_id);
CREATE INDEX IF NOT EXISTS idx_uo_unit ON public.unit_owners(unit_id);

DROP TRIGGER IF EXISTS unit_owners_updated_at ON public.unit_owners;
CREATE TRIGGER unit_owners_updated_at BEFORE UPDATE ON public.unit_owners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 3. revenue_periods
-- ============================================================
CREATE TABLE IF NOT EXISTS public.revenue_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  frequency text NOT NULL DEFAULT 'mensual' CHECK (frequency IN ('mensual', 'bimestral', 'trimestral', 'anual')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date NOT NULL DEFAULT CURRENT_DATE + interval '1 year',
  billing_day smallint NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 31),
  due_day smallint NOT NULL DEFAULT 5 CHECK (due_day BETWEEN 1 AND 31),
  grace_days integer NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
  offset_days integer NOT NULL DEFAULT 0,
  interest_start_date date,
  late_interest_rate numeric(6,4) NOT NULL DEFAULT 0.0000,
  discount_threshold_days integer NOT NULL DEFAULT 0 CHECK (discount_threshold_days >= 0),
  discount_rate numeric(6,4) NOT NULL DEFAULT 0.0000,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

ALTER TABLE public.revenue_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rp_select_org" ON public.revenue_periods;
CREATE POLICY "rp_select_org" ON public.revenue_periods FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "rp_insert_org" ON public.revenue_periods;
CREATE POLICY "rp_insert_org" ON public.revenue_periods FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "rp_update_org" ON public.revenue_periods;
CREATE POLICY "rp_update_org" ON public.revenue_periods FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "rp_delete_org" ON public.revenue_periods;
CREATE POLICY "rp_delete_org" ON public.revenue_periods FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

CREATE INDEX IF NOT EXISTS idx_rp_org ON public.revenue_periods(organization_id);

DROP TRIGGER IF EXISTS revenue_periods_updated_at ON public.revenue_periods;
CREATE TRIGGER revenue_periods_updated_at BEFORE UPDATE ON public.revenue_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 4. billing_concepts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.billing_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text DEFAULT '',
  category text NOT NULL DEFAULT 'administracion' CHECK (category IN ('administracion', 'extraordinaria', 'penalizacion', 'reserva', 'fondo', 'servicio', 'otro')),
  account_class text NOT NULL DEFAULT 'real' CHECK (account_class IN ('real', 'orden')),
  income_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  counterpart_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  parent_concept_id uuid REFERENCES public.billing_concepts(id) ON DELETE CASCADE,
  is_late_interest boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, code)
);

ALTER TABLE public.billing_concepts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bc_select_org" ON public.billing_concepts;
CREATE POLICY "bc_select_org" ON public.billing_concepts FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "bc_insert_org" ON public.billing_concepts;
CREATE POLICY "bc_insert_org" ON public.billing_concepts FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "bc_update_org" ON public.billing_concepts;
CREATE POLICY "bc_update_org" ON public.billing_concepts FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "bc_delete_org" ON public.billing_concepts;
CREATE POLICY "bc_delete_org" ON public.billing_concepts FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

CREATE INDEX IF NOT EXISTS idx_bc_org ON public.billing_concepts(organization_id);
CREATE INDEX IF NOT EXISTS idx_bc_parent ON public.billing_concepts(parent_concept_id);

DROP TRIGGER IF EXISTS billing_concepts_updated_at ON public.billing_concepts;
CREATE TRIGGER billing_concepts_updated_at BEFORE UPDATE ON public.billing_concepts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 5. Función: asegurar concepto "Cuota de Administración" por defecto
--    para organizaciones residenciales (no inserta cuentas, solo el concepto)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_default_billing_concept(org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  INSERT INTO public.billing_concepts (organization_id, code, name, description, category, account_class, is_default, is_active)
  VALUES (org_id, 'ADM', 'Cuota de Administración', 'Cuota ordinaria mensual de administración conforme Ley 675/2001', 'administracion', 'real', true, true)
  ON CONFLICT (organization_id, code) DO NOTHING;
END $func$;

REVOKE EXECUTE ON FUNCTION public.ensure_default_billing_concept(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_billing_concept(uuid) TO authenticated;
