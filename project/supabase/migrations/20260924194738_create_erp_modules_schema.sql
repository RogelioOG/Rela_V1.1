/*
# Rela ERP — Módulos Comerciales, PH y Contables

## Descripción
Crea todas las tablas para los módulos funcionales de Rela ERP:
- Módulo Comercial (Terceros, Inventario, Facturación, Caja)
- Módulo de Propiedad Horizontal (Inmuebles, Cuotas, Recaudos)
- Módulo Contable (Plan de Cuentas, Asientos)

Todas las tablas usan `organization_id` para aislamiento multi-tenant.
Las políticas RLS permiten acceso a usuarios master o miembros de la organización.

## Tablas Nuevas

### Módulo Comercial
1. `third_parties` — Clientes y Proveedores (NIT/Cédula, dirección, teléfono, tipo)
2. `products` — Inventario (SKU, nombre, categoría, stock, precios COP)
3. `invoices` — Facturas/Ventas (cliente, total, medio de pago, estado)
4. `invoice_items` — Detalle de factura (producto, cantidad, precio)
5. `cash_entries` — Ingresos y egresos de caja (tipo, monto, concepto)

### Módulo Propiedad Horizontal
6. `units` — Unidades privadas (torre, apartamento, coeficiente, propietario)
7. `dues` — Cuotas de administración (ordinaria/extraordinaria, monto, intereses)
8. `payments` — Recaudos/pagos de cuotas (monto, fecha, método)

### Módulo Contable
9. `accounts` — Plan de cuentas (código, nombre, tipo: activo/pasivo/patrimonio/ingreso/gasto)
10. `journal_entries` — Asientos contables (fecha, descripción)
11. `journal_lines` — Líneas de asiento (cuenta, débito, crédito)

## Seguridad (RLS)
- Todas las tablas: SELECT/INSERT/UPDATE/DELETE para master o miembros de la organización.
- Se usa `is_master_user()` (SECURITY DEFINER, ya existe) o verificación
  de membresía vía `user_organizations`.
*/

-- ============================================================
-- FUNCIÓN HELPER: Verificar acceso a organización
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_org_access(org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_master_user()
  OR EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid() AND uo.organization_id = org_id
  )
$$;

-- ============================================================
-- TABLA: third_parties (Terceros - Clientes y Proveedores)
-- ============================================================
CREATE TABLE IF NOT EXISTS third_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'cliente' CHECK (type IN ('cliente', 'proveedor')),
  name text NOT NULL,
  document_type text NOT NULL DEFAULT 'nit' CHECK (document_type IN ('nit', 'cedula')),
  document_number text NOT NULL DEFAULT '',
  address text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  city text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE third_parties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tp_select_org" ON third_parties;
CREATE POLICY "tp_select_org" ON third_parties FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "tp_insert_org" ON third_parties;
CREATE POLICY "tp_insert_org" ON third_parties FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "tp_update_org" ON third_parties;
CREATE POLICY "tp_update_org" ON third_parties FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "tp_delete_org" ON third_parties;
CREATE POLICY "tp_delete_org" ON third_parties FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

-- ============================================================
-- TABLA: products (Inventario)
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku text NOT NULL DEFAULT '',
  name text NOT NULL,
  category text NOT NULL DEFAULT '',
  stock numeric(14,2) NOT NULL DEFAULT 0,
  min_stock numeric(14,2) NOT NULL DEFAULT 0,
  cost_price numeric(14,2) NOT NULL DEFAULT 0,
  sale_price numeric(14,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, sku)
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prod_select_org" ON products;
CREATE POLICY "prod_select_org" ON products FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "prod_insert_org" ON products;
CREATE POLICY "prod_insert_org" ON products FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "prod_update_org" ON products;
CREATE POLICY "prod_update_org" ON products FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "prod_delete_org" ON products;
CREATE POLICY "prod_delete_org" ON products FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

-- ============================================================
-- TABLA: invoices (Facturas / Ventas)
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL DEFAULT '',
  third_party_id uuid REFERENCES third_parties(id) ON DELETE SET NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  tax numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'efectivo' CHECK (payment_method IN ('efectivo', 'transferencia', 'credito')),
  status text NOT NULL DEFAULT 'pagada' CHECK (status IN ('pagada', 'credito', 'anulada')),
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_select_org" ON invoices;
CREATE POLICY "inv_select_org" ON invoices FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "inv_insert_org" ON invoices;
CREATE POLICY "inv_insert_org" ON invoices FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "inv_update_org" ON invoices;
CREATE POLICY "inv_update_org" ON invoices FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "inv_delete_org" ON invoices;
CREATE POLICY "inv_delete_org" ON invoices FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

-- ============================================================
-- TABLA: invoice_items (Detalle de Factura)
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric(14,2) NOT NULL DEFAULT 1,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  line_total numeric(14,2) NOT NULL DEFAULT 0
);

ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ii_select_org" ON invoice_items;
CREATE POLICY "ii_select_org" ON invoice_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.has_org_access(i.organization_id)));
DROP POLICY IF EXISTS "ii_insert_org" ON invoice_items;
CREATE POLICY "ii_insert_org" ON invoice_items FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.has_org_access(i.organization_id)));
DROP POLICY IF EXISTS "ii_delete_org" ON invoice_items;
CREATE POLICY "ii_delete_org" ON invoice_items FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.has_org_access(i.organization_id)));

-- ============================================================
-- TABLA: cash_entries (Caja y Egresos)
-- ============================================================
CREATE TABLE IF NOT EXISTS cash_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('ingreso', 'egreso')),
  date date NOT NULL DEFAULT CURRENT_DATE,
  concept text NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'efectivo' CHECK (payment_method IN ('efectivo', 'transferencia')),
  reference text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cash_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ce_select_org" ON cash_entries;
CREATE POLICY "ce_select_org" ON cash_entries FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "ce_insert_org" ON cash_entries;
CREATE POLICY "ce_insert_org" ON cash_entries FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "ce_update_org" ON cash_entries;
CREATE POLICY "ce_update_org" ON cash_entries FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "ce_delete_org" ON cash_entries;
CREATE POLICY "ce_delete_org" ON cash_entries FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

-- ============================================================
-- TABLA: units (Inmuebles / Unidades PH)
-- ============================================================
CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tower text NOT NULL DEFAULT '',
  unit_label text NOT NULL,
  type text NOT NULL DEFAULT 'apartamento' CHECK (type IN ('apartamento', 'casa', 'local', 'oficina', 'parqueadero')),
  coefficient numeric(8,6) NOT NULL DEFAULT 0,
  owner_name text DEFAULT '',
  owner_document text DEFAULT '',
  owner_phone text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "units_select_org" ON units;
CREATE POLICY "units_select_org" ON units FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "units_insert_org" ON units;
CREATE POLICY "units_insert_org" ON units FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "units_update_org" ON units;
CREATE POLICY "units_update_org" ON units FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "units_delete_org" ON units;
CREATE POLICY "units_delete_org" ON units FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

-- ============================================================
-- TABLA: dues (Cuotas de Administración)
-- ============================================================
CREATE TABLE IF NOT EXISTS dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'ordinaria' CHECK (type IN ('ordinaria', 'extraordinaria')),
  period text NOT NULL,
  due_date date NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  interest_rate numeric(6,4) NOT NULL DEFAULT 0.0000,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'pagada', 'parcial', 'anulada')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dues_select_org" ON dues;
CREATE POLICY "dues_select_org" ON dues FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "dues_insert_org" ON dues;
CREATE POLICY "dues_insert_org" ON dues FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "dues_update_org" ON dues;
CREATE POLICY "dues_update_org" ON dues FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "dues_delete_org" ON dues;
CREATE POLICY "dues_delete_org" ON dues FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

-- ============================================================
-- TABLA: payments (Recaudos)
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  due_id uuid NOT NULL REFERENCES dues(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'efectivo' CHECK (method IN ('efectivo', 'transferencia', 'cheque')),
  reference text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pay_select_org" ON payments;
CREATE POLICY "pay_select_org" ON payments FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "pay_insert_org" ON payments;
CREATE POLICY "pay_insert_org" ON payments FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "pay_delete_org" ON payments;
CREATE POLICY "pay_delete_org" ON payments FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

-- ============================================================
-- TABLA: accounts (Plan de Cuentas)
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto')),
  parent_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, code)
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acc_select_org" ON accounts;
CREATE POLICY "acc_select_org" ON accounts FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "acc_insert_org" ON accounts;
CREATE POLICY "acc_insert_org" ON accounts FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "acc_update_org" ON accounts;
CREATE POLICY "acc_update_org" ON accounts FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "acc_delete_org" ON accounts;
CREATE POLICY "acc_delete_org" ON accounts FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

-- ============================================================
-- TABLA: journal_entries (Asientos Contables)
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL DEFAULT '',
  reference_type text DEFAULT '',
  reference_id uuid DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "je_select_org" ON journal_entries;
CREATE POLICY "je_select_org" ON journal_entries FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "je_insert_org" ON journal_entries;
CREATE POLICY "je_insert_org" ON journal_entries FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "je_delete_org" ON journal_entries;
CREATE POLICY "je_delete_org" ON journal_entries FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

-- ============================================================
-- TABLA: journal_lines (Líneas de Asiento)
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  debit numeric(14,2) NOT NULL DEFAULT 0,
  credit numeric(14,2) NOT NULL DEFAULT 0
);

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jl_select_org" ON journal_lines;
CREATE POLICY "jl_select_org" ON journal_lines FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = journal_entry_id AND public.has_org_access(je.organization_id)));
DROP POLICY IF EXISTS "jl_insert_org" ON journal_lines;
CREATE POLICY "jl_insert_org" ON journal_lines FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = journal_entry_id AND public.has_org_access(je.organization_id)));
DROP POLICY IF EXISTS "jl_delete_org" ON journal_lines;
CREATE POLICY "jl_delete_org" ON journal_lines FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = journal_entry_id AND public.has_org_access(je.organization_id)));

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tp_org ON third_parties(organization_id);
CREATE INDEX IF NOT EXISTS idx_prod_org ON products(organization_id);
CREATE INDEX IF NOT EXISTS idx_inv_org ON invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_inv_date ON invoices(date);
CREATE INDEX IF NOT EXISTS idx_ii_inv ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ce_org ON cash_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_units_org ON units(organization_id);
CREATE INDEX IF NOT EXISTS idx_dues_org ON dues(organization_id);
CREATE INDEX IF NOT EXISTS idx_dues_unit ON dues(unit_id);
CREATE INDEX IF NOT EXISTS idx_dues_status ON dues(status);
CREATE INDEX IF NOT EXISTS idx_pay_org ON payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_pay_due ON payments(due_id);
CREATE INDEX IF NOT EXISTS idx_acc_org ON accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_je_org ON journal_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_jl_je ON journal_lines(journal_entry_id);

-- ============================================================
-- TRIGERS updated_at para nuevas tablas
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

DROP TRIGGER IF EXISTS third_parties_updated_at ON third_parties;
CREATE TRIGGER third_parties_updated_at BEFORE UPDATE ON third_parties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS units_updated_at ON units;
CREATE TRIGGER units_updated_at BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
