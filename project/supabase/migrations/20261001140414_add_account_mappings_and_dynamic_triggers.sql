/*
# Account Mapping Configuration + Dynamic Trigger Integration

1. New table `account_mappings` — maps system movement types to specific accounts per org
2. New function `get_mapping_account_id()` — returns mapped account or falls back to pattern matching
3. All accounting triggers updated to use `get_mapping_account_id()`
*/

CREATE TABLE IF NOT EXISTS account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  movement_type text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  debit_credit text NOT NULL DEFAULT 'debit' CHECK (debit_credit IN ('debit', 'credit')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, movement_type)
);

ALTER TABLE account_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "am_select_org" ON account_mappings;
CREATE POLICY "am_select_org" ON account_mappings FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "am_insert_org" ON account_mappings;
CREATE POLICY "am_insert_org" ON account_mappings FOR INSERT TO authenticated
  WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "am_update_org" ON account_mappings;
CREATE POLICY "am_update_org" ON account_mappings FOR UPDATE TO authenticated
  USING (public.has_org_access(organization_id)) WITH CHECK (public.has_org_access(organization_id));
DROP POLICY IF EXISTS "am_delete_org" ON account_mappings;
CREATE POLICY "am_delete_org" ON account_mappings FOR DELETE TO authenticated
  USING (public.has_org_access(organization_id));

CREATE INDEX IF NOT EXISTS idx_am_org ON account_mappings(organization_id);

CREATE OR REPLACE FUNCTION public.get_mapping_account_id(org_id uuid, p_movement_type text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_mapped_id uuid;
BEGIN
  SELECT account_id INTO v_mapped_id
  FROM public.account_mappings
  WHERE organization_id = org_id AND movement_type = p_movement_type
  LIMIT 1;
  IF v_mapped_id IS NOT NULL THEN
    RETURN v_mapped_id;
  END IF;
  PERFORM public.ensure_default_accounts(org_id);
  IF p_movement_type = 'venta_efectivo_caja' THEN
    RETURN public.get_account_id(org_id, 'activo', 'caja');
  ELSIF p_movement_type = 'venta_efectivo_ingreso' THEN
    RETURN public.get_account_id(org_id, 'ingreso', 'ventas');
  ELSIF p_movement_type = 'venta_credito_cartera' THEN
    RETURN public.get_account_id(org_id, 'activo', 'cobrar');
  ELSIF p_movement_type = 'venta_credito_ingreso' THEN
    RETURN public.get_account_id(org_id, 'ingreso', 'ventas');
  ELSIF p_movement_type = 'iva_recaudado' THEN
    RETURN public.get_account_id(org_id, 'pasivo', 'iva');
  ELSIF p_movement_type = 'cogs_costo' THEN
    RETURN public.get_account_id(org_id, 'gasto', 'costo');
  ELSIF p_movement_type = 'cogs_inventario' THEN
    RETURN public.get_account_id(org_id, 'activo', 'inventario');
  ELSIF p_movement_type = 'compra_inventario' THEN
    RETURN public.get_account_id(org_id, 'activo', 'inventario');
  ELSIF p_movement_type = 'compra_caja' THEN
    RETURN public.get_account_id(org_id, 'activo', 'caja');
  ELSIF p_movement_type = 'recaudo_caja' THEN
    RETURN public.get_account_id(org_id, 'activo', 'caja');
  ELSIF p_movement_type = 'recaudo_ingreso' THEN
    RETURN public.get_account_id(org_id, 'ingreso', 'cuota');
  ELSIF p_movement_type = 'caja_ingreso' THEN
    RETURN public.get_account_id(org_id, 'activo', 'caja');
  ELSIF p_movement_type = 'caja_ingreso_contrapartida' THEN
    RETURN public.get_account_id(org_id, 'ingreso');
  ELSIF p_movement_type = 'caja_egreso' THEN
    RETURN public.get_account_id(org_id, 'activo', 'caja');
  ELSIF p_movement_type = 'caja_egreso_contrapartida' THEN
    RETURN public.get_account_id(org_id, 'gasto');
  ELSIF p_movement_type = 'inventario_activo' THEN
    RETURN public.get_account_id(org_id, 'activo', 'inventario');
  ELSIF p_movement_type = 'salida_inventario_caja' THEN
    RETURN public.get_account_id(org_id, 'activo', 'caja');
  ELSE
    RETURN NULL;
  END IF;
END $func$;

CREATE OR REPLACE FUNCTION public.fn_product_inventory_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_inv_acc uuid;
  v_caja_acc uuid;
  v_old_val numeric;
  v_new_val numeric;
  v_delta numeric;
  v_abs_delta numeric;
  v_lines jsonb;
BEGIN
  PERFORM public.ensure_default_accounts(NEW.organization_id);
  v_inv_acc := public.get_mapping_account_id(NEW.organization_id, 'inventario_activo');
  v_caja_acc := public.get_mapping_account_id(NEW.organization_id, 'compra_caja');
  IF v_inv_acc IS NULL OR v_caja_acc IS NULL THEN
    RETURN NEW;
  END IF;
  v_new_val := NEW.stock * NEW.cost_price;
  IF TG_OP = 'INSERT' THEN
    v_old_val := 0;
  ELSE
    v_old_val := OLD.stock * OLD.cost_price;
  END IF;
  v_delta := v_new_val - v_old_val;
  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;
  v_abs_delta := v_delta;
  IF v_abs_delta < 0 THEN
    v_abs_delta := -v_abs_delta;
  END IF;
  IF v_delta > 0 THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_inv_acc, 'debit', v_delta, 'credit', 0),
      jsonb_build_object('account_id', v_caja_acc, 'debit', 0, 'credit', v_delta)
    );
    PERFORM public.post_journal_entry(NEW.organization_id, CURRENT_DATE, 'Registro de inventario: ' || NEW.name, 'product', NEW.id, v_lines);
  ELSE
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_caja_acc, 'debit', v_abs_delta, 'credit', 0),
      jsonb_build_object('account_id', v_inv_acc, 'debit', 0, 'credit', v_abs_delta)
    );
    PERFORM public.post_journal_entry(NEW.organization_id, CURRENT_DATE, 'Salida de inventario: ' || NEW.name, 'product', NEW.id, v_lines);
  END IF;
  RETURN NEW;
END $func$;

CREATE OR REPLACE FUNCTION public.fn_invoice_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caja_acc uuid;
  v_cartera_acc uuid;
  v_ventas_acc uuid;
  v_iva_acc uuid;
  v_cogs_acc uuid;
  v_cogs_inv_acc uuid;
  v_lines jsonb;
BEGIN
  IF NEW.status = 'anulada' THEN
    RETURN NEW;
  END IF;
  PERFORM public.ensure_default_accounts(NEW.organization_id);
  v_caja_acc := public.get_mapping_account_id(NEW.organization_id, 'venta_efectivo_caja');
  v_cartera_acc := public.get_mapping_account_id(NEW.organization_id, 'venta_credito_cartera');
  v_ventas_acc := public.get_mapping_account_id(NEW.organization_id, 'venta_efectivo_ingreso');
  v_iva_acc := public.get_mapping_account_id(NEW.organization_id, 'iva_recaudado');
  v_cogs_acc := public.get_mapping_account_id(NEW.organization_id, 'cogs_costo');
  v_cogs_inv_acc := public.get_mapping_account_id(NEW.organization_id, 'cogs_inventario');
  IF v_ventas_acc IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_method = 'credito' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', COALESCE(v_cartera_acc, v_caja_acc), 'debit', NEW.total, 'credit', 0),
      jsonb_build_object('account_id', v_ventas_acc, 'debit', 0, 'credit', NEW.subtotal)
    );
  ELSE
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_caja_acc, 'debit', NEW.total, 'credit', 0),
      jsonb_build_object('account_id', v_ventas_acc, 'debit', 0, 'credit', NEW.subtotal)
    );
  END IF;
  IF NEW.tax > 0 AND v_iva_acc IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_iva_acc, 'debit', 0, 'credit', NEW.tax)
    );
  END IF;
  IF v_cogs_acc IS NOT NULL AND v_cogs_inv_acc IS NOT NULL AND NEW.subtotal > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_cogs_acc, 'debit', NEW.subtotal, 'credit', 0),
      jsonb_build_object('account_id', v_cogs_inv_acc, 'debit', 0, 'credit', NEW.subtotal)
    );
  END IF;
  PERFORM public.post_journal_entry(NEW.organization_id, NEW.date, 'Factura ' || NEW.number, 'invoice', NEW.id, v_lines);
  RETURN NEW;
END $func$;

CREATE OR REPLACE FUNCTION public.fn_cash_entry_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caja_acc uuid;
  v_contra_acc uuid;
  v_lines jsonb;
BEGIN
  PERFORM public.ensure_default_accounts(NEW.organization_id);
  IF NEW.type = 'ingreso' THEN
    v_caja_acc := public.get_mapping_account_id(NEW.organization_id, 'caja_ingreso');
    v_contra_acc := public.get_mapping_account_id(NEW.organization_id, 'caja_ingreso_contrapartida');
  ELSE
    v_caja_acc := public.get_mapping_account_id(NEW.organization_id, 'caja_egreso');
    v_contra_acc := public.get_mapping_account_id(NEW.organization_id, 'caja_egreso_contrapartida');
  END IF;
  IF v_caja_acc IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.type = 'ingreso' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_caja_acc, 'debit', NEW.amount, 'credit', 0),
      jsonb_build_object('account_id', COALESCE(v_contra_acc, v_caja_acc), 'debit', 0, 'credit', NEW.amount)
    );
  ELSE
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', COALESCE(v_contra_acc, v_caja_acc), 'debit', NEW.amount, 'credit', 0),
      jsonb_build_object('account_id', v_caja_acc, 'debit', 0, 'credit', NEW.amount)
    );
  END IF;
  PERFORM public.post_journal_entry(NEW.organization_id, NEW.date, NEW.concept, 'cash_entry', NEW.id, v_lines);
  RETURN NEW;
END $func$;

CREATE OR REPLACE FUNCTION public.fn_payment_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caja_acc uuid;
  v_ingreso_acc uuid;
  v_lines jsonb;
BEGIN
  PERFORM public.ensure_default_accounts(NEW.organization_id);
  v_caja_acc := public.get_mapping_account_id(NEW.organization_id, 'recaudo_caja');
  v_ingreso_acc := public.get_mapping_account_id(NEW.organization_id, 'recaudo_ingreso');
  IF v_caja_acc IS NULL OR v_ingreso_acc IS NULL THEN
    RETURN NEW;
  END IF;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_caja_acc, 'debit', NEW.amount, 'credit', 0),
    jsonb_build_object('account_id', v_ingreso_acc, 'debit', 0, 'credit', NEW.amount)
  );
  PERFORM public.post_journal_entry(NEW.organization_id, NEW.date, 'Recaudo cuota de administracion', 'payment', NEW.id, v_lines);
  RETURN NEW;
END $func$;
