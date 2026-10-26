/*
# Fix Profiles RLS for Org Admins + Accounting Triggers + Inventory Valuation

## Problem
1. The `profiles` SELECT policy only allows `auth.uid() = id OR is_master_user()`.
   When an org admin loads `user_organizations` with `profiles(*)` join, the profiles
   of other users in their org are filtered out by RLS — so newly created users don't
   appear in the organization's users table.

2. No accounting integration exists. Inventory additions, invoice creation, and cash
   entries don't generate journal entries. Financial reports show zeroes for inventory.

## Changes

### 1. New SECURITY DEFINER function: `is_org_admin_of_user(target_user_id)`
Returns true if the current user is an admin (or master) of any organization
that `target_user_id` also belongs to. Used in profiles RLS so org admins can
see and manage all profiles within their organization.

### 2. Updated profiles RLS policies
- SELECT: own profile, master, or org admin of the target user's org
- UPDATE: own profile, master, or org admin of the target user's org
- INSERT: master, or any authenticated user (edge function handles auth via service role)
- DELETE: master only

### 3. New SECURITY DEFINER function: `post_journal_entry()`
A helper that creates a journal_entry + journal_lines atomically. Used by triggers.

### 4. New triggers for automatic double-entry accounting:
- `trg_product_inventory_accounting` (AFTER INSERT/UPDATE on products):
  Generates journal entry: Debit Inventario (Activo), Credit Caja/Bancos (Activo)
  when stock or cost_price changes, valued at stock * cost_price delta.
- `trg_invoice_accounting` (AFTER INSERT on invoices):
  Generates journal entry: Debit Caja/Cartera (Activo), Credit Ingresos por Ventas
  (Ingreso) + IVA por Pagar (Pasivo).
- `trg_cash_entry_accounting` (AFTER INSERT on cash_entries):
  Generates journal entry: Debit Caja (Activo) for ingresos, Credit Caja (Activo)
  for egresos, with corresponding Credit/Debit to the appropriate account.

### 5. Auto-ensure chart of accounts: `ensure_default_accounts()`
Creates a default Colombian PUC chart of accounts for an organization if none exists,
so triggers can find the right accounts by type + name pattern.
*/

-- ============================================================
-- FUNCTION: is_org_admin_of_user — Check if caller is admin of target user's org
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_org_admin_of_user(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_master_user()
  OR EXISTS (
    SELECT 1 FROM public.user_organizations caller_uo
    JOIN public.user_organizations target_uo
      ON target_uo.organization_id = caller_uo.organization_id
    WHERE caller_uo.user_id = auth.uid()
      AND caller_uo.role = 'admin'
      AND target_uo.user_id = target_user_id
  )
$$;

-- ============================================================
-- DROP OLD profiles policies and recreate with org admin access
-- ============================================================
DROP POLICY IF EXISTS "profiles_select_own_or_master" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_master_only" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own_or_master" ON profiles;
DROP POLICY IF EXISTS "profiles_delete_master_only" ON profiles;

CREATE POLICY "profiles_select" ON profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR public.is_master_user()
    OR public.is_org_admin_of_user(id)
  );

CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_master_user() OR auth.uid() = id);

CREATE POLICY "profiles_update" ON profiles FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id
    OR public.is_master_user()
    OR public.is_org_admin_of_user(id)
  )
  WITH CHECK (
    auth.uid() = id
    OR public.is_master_user()
    OR public.is_org_admin_of_user(id)
  );

CREATE POLICY "profiles_delete" ON profiles FOR DELETE
  TO authenticated
  USING (public.is_master_user());

-- ============================================================
-- FUNCTION: ensure_default_accounts — Create default PUC chart of accounts
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_default_accounts(org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acc_count integer;
BEGIN
  SELECT COUNT(*) INTO acc_count FROM public.accounts WHERE organization_id = org_id;
  IF acc_count > 0 THEN RETURN; END IF;

  -- Activos
  INSERT INTO public.accounts (organization_id, code, name, type) VALUES
    (org_id, '1105', 'Caja General', 'activo'),
    (org_id, '1110', 'Bancos', 'activo'),
    (org_id, '1305', 'Cuentas por Cobrar', 'activo'),
    (org_id, '1435', 'Inventario Mercancías', 'activo');
  -- Pasivos
  INSERT INTO public.accounts (organization_id, code, name, type) VALUES
    (org_id, '2205', 'Cuentas por Pagar', 'pasivo'),
    (org_id, '2408', 'IVA por Pagar', 'pasivo');
  -- Patrimonio
  INSERT INTO public.accounts (organization_id, code, name, type) VALUES
    (org_id, '3105', 'Capital Social', 'patrimonio'),
    (org_id, '3605', 'Utilidad del Periodo', 'patrimonio');
  -- Ingresos
  INSERT INTO public.accounts (organization_id, code, name, type) VALUES
    (org_id, '4135', 'Ingresos por Ventas', 'ingreso'),
    (org_id, '4210', 'Ingresos por Cuotas de Administración', 'ingreso');
  -- Gastos
  INSERT INTO public.accounts (organization_id, code, name, type) VALUES
    (org_id, '5105', 'Gastos Operacionales', 'gasto'),
    (org_id, '6115', 'Costo de Mercancías Vendidas', 'gasto'),
    (org_id, '1430', 'Compras de Mercancías', 'gasto');
END $$;

-- ============================================================
-- FUNCTION: post_journal_entry — Create journal entry + lines atomically
-- ============================================================
CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_org_id uuid,
  p_date date,
  p_description text,
  p_reference_type text,
  p_reference_id uuid,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_line jsonb;
  v_account_id uuid;
  v_debit numeric;
  v_credit numeric;
BEGIN
  -- Ensure accounts exist
  PERFORM public.ensure_default_accounts(p_org_id);

  INSERT INTO public.journal_entries (organization_id, date, description, reference_type, reference_id)
  VALUES (p_org_id, p_date, p_description, p_reference_type, p_reference_id)
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_account_id := v_line->>'account_id';
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);

    IF v_account_id IS NULL OR (v_debit = 0 AND v_credit = 0) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (v_entry_id, v_account_id::uuid, v_debit, v_credit);
  END LOOP;

  RETURN v_entry_id;
END $$;

-- ============================================================
-- HELPER: get_account_by_type — Find an account by org + type + name pattern
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_account_id(org_id uuid, acc_type text, name_pattern text DEFAULT NULL)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.accounts
  WHERE organization_id = org_id
    AND type = acc_type
    AND (name_pattern IS NULL OR name ILIKE '%' || name_pattern || '%')
  ORDER BY
    CASE WHEN name_pattern IS NOT NULL AND name ILIKE '%' || name_pattern || '%' THEN 0 ELSE 1 END,
    code
  LIMIT 1
$$;

-- ============================================================
-- TRIGGER: Inventory accounting on products INSERT/UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_product_inventory_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inventario_acc uuid;
  v_caja_acc uuid;
  v_old_value numeric;
  v_new_value numeric;
  v_delta numeric;
BEGIN
  -- Ensure chart of accounts exists
  PERFORM public.ensure_default_accounts(NEW.organization_id);

  v_inventario_acc := public.get_account_id(NEW.organization_id, 'activo', 'inventario');
  v_caja_acc := public.get_account_id(NEW.organization_id, 'activo', 'caja');

  IF v_inventario_acc IS NULL THEN RETURN NEW; END IF;

  v_new_value := NEW.stock * NEW.cost_price;

  IF TG_OP = 'INSERT' THEN
    v_old_value := 0;
  ELSE
    v_old_value := OLD.stock * OLD.cost_price;
  END IF;

  v_delta := v_new_value - v_old_value;

  -- Only post if there's a meaningful change
  IF v_delta = 0 THEN RETURN NEW; END IF;
  IF v_caja_acc IS NULL THEN RETURN NEW; END IF;

  IF v_delta > 0 THEN
    -- Inventory increased: Debit Inventario, Credit Caja
    PERFORM public.post_journal_entry(
      NEW.organization_id, CURRENT_DATE,
      'Registro de inventario: ' || NEW.name,
      'product', NEW.id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_inventario_acc, 'debit', v_delta, 'credit', 0),
        jsonb_build_object('account_id', v_caja_acc, 'debit', 0, 'credit', v_delta)
      )
    );
  ELSE
    -- Inventory decreased: Debit Caja, Credit Inventario
    PERFORM public.post_journal_entry(
      NEW.organization_id, CURRENT_DATE,
      'Salida de inventario: ' || NEW.name,
      'product', NEW.id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_caja_acc, 'debit', ABS(v_delta), 'credit', 0),
        jsonb_build_object('account_id', v_inventario_acc, 'debit', 0, 'credit', ABS(v_delta))
      )
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_product_inventory_accounting ON products;
CREATE TRIGGER trg_product_inventory_accounting
  AFTER INSERT OR UPDATE OF stock, cost_price ON products
  FOR EACH ROW EXECUTE FUNCTION public.fn_product_inventory_accounting();

-- ============================================================
-- TRIGGER: Invoice accounting on invoices INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_invoice_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_acc uuid;
  v_cartera_acc uuid;
  v_ventas_acc uuid;
  v_iva_acc uuid;
  v_cogs_acc uuid;
  v_inventario_acc uuid;
  v_lines jsonb;
BEGIN
  IF NEW.status = 'anulada' THEN RETURN NEW; END IF;

  PERFORM public.ensure_default_accounts(NEW.organization_id);

  v_caja_acc := public.get_account_id(NEW.organization_id, 'activo', 'caja');
  v_cartera_acc := public.get_account_id(NEW.organization_id, 'activo', 'cobrar');
  v_ventas_acc := public.get_account_id(NEW.organization_id, 'ingreso', 'ventas');
  v_iva_acc := public.get_account_id(NEW.organization_id, 'pasivo', 'iva');

  IF v_ventas_acc IS NULL THEN RETURN NEW; END IF;

  IF NEW.payment_method = 'credito' THEN
    -- Credit sale: Debit Cartera, Credit Ventas + IVA
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_cartera_acc, 'debit', NEW.total, 'credit', 0),
      jsonb_build_object('account_id', v_ventas_acc, 'debit', 0, 'credit', NEW.subtotal)
    );
    IF NEW.tax > 0 AND v_iva_acc IS NOT NULL THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_id', v_iva_acc, 'debit', 0, 'credit', NEW.tax)
      );
    END IF;
  ELSE
    -- Cash/transfer sale: Debit Caja, Credit Ventas + IVA
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_caja_acc, 'debit', NEW.total, 'credit', 0),
      jsonb_build_object('account_id', v_ventas_acc, 'debit', 0, 'credit', NEW.subtotal)
    );
    IF NEW.tax > 0 AND v_iva_acc IS NOT NULL THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_id', v_iva_acc, 'debit', 0, 'credit', NEW.tax)
      );
    END IF;
  END IF;

  -- COGS entry: Debit Costo de Ventas, Credit Inventario (approximated by subtotal)
  v_cogs_acc := public.get_account_id(NEW.organization_id, 'gasto', 'costo');
  v_inventario_acc := public.get_account_id(NEW.organization_id, 'activo', 'inventario');
  IF v_cogs_acc IS NOT NULL AND v_inventario_acc IS NOT NULL AND NEW.subtotal > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_cogs_acc, 'debit', NEW.subtotal, 'credit', 0),
      jsonb_build_object('account_id', v_inventario_acc, 'debit', 0, 'credit', NEW.subtotal)
    );
  END IF;

  PERFORM public.post_journal_entry(
    NEW.organization_id, NEW.date,
    'Factura ' || NEW.number,
    'invoice', NEW.id,
    v_lines
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_accounting ON invoices;
CREATE TRIGGER trg_invoice_accounting
  AFTER INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_accounting();

-- ============================================================
-- TRIGGER: Cash entry accounting on cash_entries INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_cash_entry_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_acc uuid;
  v_lines jsonb;
BEGIN
  PERFORM public.ensure_default_accounts(NEW.organization_id);

  v_caja_acc := public.get_account_id(NEW.organization_id, 'activo', 'caja');
  IF v_caja_acc IS NULL THEN RETURN NEW; END IF;

  IF NEW.type = 'ingreso' THEN
    -- Ingreso de caja: Debit Caja, Credit Ingresos
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_caja_acc, 'debit', NEW.amount, 'credit', 0),
      jsonb_build_object('account_id', public.get_account_id(NEW.organization_id, 'ingreso'), 'debit', 0, 'credit', NEW.amount)
    );
  ELSE
    -- Egreso de caja: Debit Gasto, Credit Caja
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', public.get_account_id(NEW.organization_id, 'gasto'), 'debit', NEW.amount, 'credit', 0),
      jsonb_build_object('account_id', v_caja_acc, 'debit', 0, 'credit', NEW.amount)
    );
  END IF;

  PERFORM public.post_journal_entry(
    NEW.organization_id, NEW.date,
    NEW.concept,
    'cash_entry', NEW.id,
    v_lines
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cash_entry_accounting ON cash_entries;
CREATE TRIGGER trg_cash_entry_accounting
  AFTER INSERT ON cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_entry_accounting();

-- ============================================================
-- TRIGGER: Payment (recaudo) accounting on payments INSERT (PH)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_payment_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_acc uuid;
  v_ingreso_acc uuid;
BEGIN
  PERFORM public.ensure_default_accounts(NEW.organization_id);

  v_caja_acc := public.get_account_id(NEW.organization_id, 'activo', 'caja');
  v_ingreso_acc := public.get_account_id(NEW.organization_id, 'ingreso', 'cuota');

  IF v_caja_acc IS NULL THEN RETURN NEW; END IF;
  IF v_ingreso_acc IS NULL THEN
    v_ingreso_acc := public.get_account_id(NEW.organization_id, 'ingreso');
  END IF;
  IF v_ingreso_acc IS NULL THEN RETURN NEW; END IF;

  PERFORM public.post_journal_entry(
    NEW.organization_id, NEW.date,
    'Recaudo cuota de administración',
    'payment', NEW.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_caja_acc, 'debit', NEW.amount, 'credit', 0),
      jsonb_build_object('account_id', v_ingreso_acc, 'debit', 0, 'credit', NEW.amount)
    )
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payment_accounting ON payments;
CREATE TRIGGER trg_payment_accounting
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_accounting();

-- Add UPDATE policy for journal_lines (needed by some operations)
DROP POLICY IF EXISTS "jl_update_org" ON journal_lines;
CREATE POLICY "jl_update_org" ON journal_lines FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = journal_entry_id AND public.has_org_access(je.organization_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = journal_entry_id AND public.has_org_access(je.organization_id)));

-- Add UPDATE policy for journal_entries
DROP POLICY IF EXISTS "je_update_org" ON journal_entries;
CREATE POLICY "je_update_org" ON journal_entries FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id))
WITH CHECK (public.has_org_access(organization_id));
