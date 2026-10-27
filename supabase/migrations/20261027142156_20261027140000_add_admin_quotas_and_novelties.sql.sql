/*
# Rela ERP — MOD-03: Cuotas de Administración & Novedades del Periodo

## Descripción
Implementa la tercera fase del módulo de Propiedad Horizontal conforme a la
Ley 675 de 2001:
1. Cuotas de Administración: configuración de cuotas base mensuales con tres
   métodos de cálculo (presupuesto dividido por coeficientes, valor fijo igual
   para todas las unidades, o ingreso manual por unidad).
2. Novedades del Periodo: registro de cargos individuales, grupales (cuotas
   extraordinarias para todas las unidades por valor fijo o por coeficiente) y
   cargos masivos importados desde Excel/CSV.

## Tablas Nuevas

### 1. `admin_quotas` (Configuración de Cuotas de Administración)
- `id` (uuid, PK)
- `organization_id` (uuid, FK → organizations)
- `revenue_period_id` (uuid, FK → revenue_periods)
- `billing_concept_id` (uuid, FK → billing_concepts)
- `calculation_method` (text) — 'presupuesto' | 'fijo' | 'manual'
  * presupuesto: monto total del presupuesto dividido entre coeficientes
  * fijo: valor igual para todas las unidades
  * manual: valor ingresado manualmente por unidad (stored in admin_quota_lines)
- `budget_amount` (numeric(14,2)) — monto total del presupuesto (method=presupuesto)
- `fixed_amount` (numeric(14,2)) — valor fijo por unidad (method=fijo)
- `rounding_decimals` (smallint, default 2) — decimales de redondeo
- `is_active` (boolean, default true)
- `created_at` / `updated_at` (timestamptz)
- UNIQUE(organization_id, revenue_period_id, billing_concept_id)

### 2. `admin_quota_lines` (Valores manuales por unidad cuando method=manual)
- `id` (uuid, PK)
- `organization_id` (uuid, FK → organizations)
- `admin_quota_id` (uuid, FK → admin_quotas, ON DELETE CASCADE)
- `unit_id` (uuid, FK → units, ON DELETE CASCADE)
- `amount` (numeric(14,2)) — valor asignado manualmente a esta unidad
- `created_at` / `updated_at` (timestamptz)
- UNIQUE(admin_quota_id, unit_id)

### 3. `period_novelties` (Novedades del Periodo)
- `id` (uuid, PK)
- `organization_id` (uuid, FK → organizations)
- `revenue_period_id` (uuid, FK → revenue_periods)
- `billing_concept_id` (uuid, FK → billing_concepts)
- `unit_id` (uuid, FK → units, nullable) — null = novedad grupal para todas las unidades
- `novelty_type` (text) — 'individual' | 'grupo' | 'masivo'
- `period_label` (text, not null) — etiqueta del periodo en formato YYYY-MM
- `description` (text, not null) — descripción de la novedad
- `value` (numeric(14,2), not null) — valor de la novedad
- `group_calculation` (text, nullable) — 'fijo' | 'coeficiente' (solo para tipo=grupo)
  * fijo: valor aplicado igual a cada unidad
  * coeficiente: valor multiplicado por el coeficiente de cada unidad
- `is_invoiced` (boolean, default false) — indica si ya fue incluida en facturación
- `created_at` / `updated_at` (timestamptz)

## Seguridad (RLS)
- Todas las tablas nuevas: SELECT/INSERT/UPDATE/DELETE con `has_org_access()`.
- Mismo patrón multi-tenant que el resto del ERP.
*/

-- ============================================================
-- 1. admin_quotas
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  revenue_period_id uuid NOT NULL REFERENCES public.revenue_periods(id) ON DELETE CASCADE,
  billing_concept_id uuid NOT NULL REFERENCES public.billing_concepts(id) ON DELETE CASCADE,
  calculation_method text NOT NULL DEFAULT 'fijo' CHECK (calculation_method IN ('presupuesto', 'fijo', 'manual')),
  budget_amount numeric(14,2) NOT NULL DEFAULT 0,
  fixed_amount numeric(14,2) NOT NULL DEFAULT 0,
  rounding_decimals smallint NOT NULL DEFAULT 2 CHECK (rounding_decimals BETWEEN 0 AND 4),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, revenue_period_id, billing_concept_id)
);

ALTER TABLE public.admin_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aq_select_org" ON public.admin_quotas;
CREATE POLICY "aq_select_org" ON public.admin_quotas FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "aq_insert_org" ON public.admin_quotas;
CREATE POLICY "aq_insert_org" ON public.admin_quotas FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "aq_update_org" ON public.admin_quotas;
CREATE POLICY "aq_update_org" ON public.admin_quotas FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "aq_delete_org" ON public.admin_quotas;
CREATE POLICY "aq_delete_org" ON public.admin_quotas FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

CREATE INDEX IF NOT EXISTS idx_aq_org ON public.admin_quotas(organization_id);
CREATE INDEX IF NOT EXISTS idx_aq_period ON public.admin_quotas(revenue_period_id);

DROP TRIGGER IF EXISTS admin_quotas_updated_at ON public.admin_quotas;
CREATE TRIGGER admin_quotas_updated_at BEFORE UPDATE ON public.admin_quotas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 2. admin_quota_lines
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_quota_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  admin_quota_id uuid NOT NULL REFERENCES public.admin_quotas(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(admin_quota_id, unit_id)
);

ALTER TABLE public.admin_quota_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aql_select_org" ON public.admin_quota_lines;
CREATE POLICY "aql_select_org" ON public.admin_quota_lines FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "aql_insert_org" ON public.admin_quota_lines;
CREATE POLICY "aql_insert_org" ON public.admin_quota_lines FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "aql_update_org" ON public.admin_quota_lines;
CREATE POLICY "aql_update_org" ON public.admin_quota_lines FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "aql_delete_org" ON public.admin_quota_lines;
CREATE POLICY "aql_delete_org" ON public.admin_quota_lines FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

CREATE INDEX IF NOT EXISTS idx_aql_quota ON public.admin_quota_lines(admin_quota_id);
CREATE INDEX IF NOT EXISTS idx_aql_unit ON public.admin_quota_lines(unit_id);

DROP TRIGGER IF EXISTS admin_quota_lines_updated_at ON public.admin_quota_lines;
CREATE TRIGGER admin_quota_lines_updated_at BEFORE UPDATE ON public.admin_quota_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 3. period_novelties
-- ============================================================
CREATE TABLE IF NOT EXISTS public.period_novelties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  revenue_period_id uuid NOT NULL REFERENCES public.revenue_periods(id) ON DELETE CASCADE,
  billing_concept_id uuid NOT NULL REFERENCES public.billing_concepts(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  novelty_type text NOT NULL DEFAULT 'individual' CHECK (novelty_type IN ('individual', 'grupo', 'masivo')),
  period_label text NOT NULL,
  description text NOT NULL DEFAULT '',
  value numeric(14,2) NOT NULL DEFAULT 0,
  group_calculation text CHECK (group_calculation IS NULL OR group_calculation IN ('fijo', 'coeficiente')),
  is_invoiced boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.period_novelties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pn_select_org" ON public.period_novelties;
CREATE POLICY "pn_select_org" ON public.period_novelties FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "pn_insert_org" ON public.period_novelties;
CREATE POLICY "pn_insert_org" ON public.period_novelties FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "pn_update_org" ON public.period_novelties;
CREATE POLICY "pn_update_org" ON public.period_novelties FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "pn_delete_org" ON public.period_novelties;
CREATE POLICY "pn_delete_org" ON public.period_novelties FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

CREATE INDEX IF NOT EXISTS idx_pn_org ON public.period_novelties(organization_id);
CREATE INDEX IF NOT EXISTS idx_pn_period ON public.period_novelties(revenue_period_id);
CREATE INDEX IF NOT EXISTS idx_pn_unit ON public.period_novelties(unit_id);
CREATE INDEX IF NOT EXISTS idx_pn_concept ON public.period_novelties(billing_concept_id);

DROP TRIGGER IF EXISTS period_novelties_updated_at ON public.period_novelties;
CREATE TRIGGER period_novelties_updated_at BEFORE UPDATE ON public.period_novelties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
