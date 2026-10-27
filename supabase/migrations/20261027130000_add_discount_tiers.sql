/*
# Rela ERP — Descuentos Escalonados por Pronto Pago (Part 2)

## Descripción
Crea la tabla `discount_tiers` para configurar descuentos multi-nivel por
pronto pago, vinculados a periodos de recaudo. Permite reglas como:
- 15% de descuento hasta el día 10
- 10% de descuento hasta el día 15
- 5% de descuento hasta el día 20

## Tabla Nueva

### `discount_tiers`
- `id` (uuid, PK)
- `organization_id` (uuid, FK → organizations)
- `revenue_period_id` (uuid, FK → revenue_periods, ON DELETE CASCADE)
- `tier_order` (integer, 1+) — orden del escalón (1 = primer descuento)
- `name` (text) — etiqueta del escalón (ej: "Pronto Pago Nivel 1")
- `discount_type` (text) — 'porcentaje' o 'monto'
- `discount_value` (numeric) — valor del descuento
- `valid_until_day` (integer, 1-31) — día límite para aplicar este escalón
- `is_active` (boolean, default true)
- UNIQUE(revenue_period_id, tier_order)

## Seguridad (RLS)
- CRUD con `has_org_access(organization_id)`, mismo patrón multi-tenant.
*/

CREATE TABLE IF NOT EXISTS public.discount_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  revenue_period_id uuid NOT NULL REFERENCES public.revenue_periods(id) ON DELETE CASCADE,
  tier_order integer NOT NULL DEFAULT 1 CHECK (tier_order >= 1),
  name text NOT NULL DEFAULT '',
  discount_type text NOT NULL DEFAULT 'porcentaje' CHECK (discount_type IN ('porcentaje', 'monto')),
  discount_value numeric(14,2) NOT NULL DEFAULT 0,
  valid_until_day integer NOT NULL DEFAULT 5 CHECK (valid_until_day >= 1 AND valid_until_day <= 31),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(revenue_period_id, tier_order)
);

ALTER TABLE public.discount_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_select_org" ON public.discount_tiers;
CREATE POLICY "dt_select_org" ON public.discount_tiers FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "dt_insert_org" ON public.discount_tiers;
CREATE POLICY "dt_insert_org" ON public.discount_tiers FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "dt_update_org" ON public.discount_tiers;
CREATE POLICY "dt_update_org" ON public.discount_tiers FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "dt_delete_org" ON public.discount_tiers;
CREATE POLICY "dt_delete_org" ON public.discount_tiers FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

CREATE INDEX IF NOT EXISTS idx_dt_org ON public.discount_tiers(organization_id);
CREATE INDEX IF NOT EXISTS idx_dt_period ON public.discount_tiers(revenue_period_id);

DROP TRIGGER IF EXISTS discount_tiers_updated_at ON public.discount_tiers;
CREATE TRIGGER discount_tiers_updated_at BEFORE UPDATE ON public.discount_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
