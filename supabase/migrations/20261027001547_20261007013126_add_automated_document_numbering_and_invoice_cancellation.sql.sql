/*
# Automated Document Numbering for System Entries + Invoice Cancellation

## Changes

### 1. Update `post_journal_entry` function
- The function now accepts two new optional parameters: `p_document_type` and `p_document_number`.
- When `p_document_type` is provided, it sets `document_type` and `document_number` on the journal entry and marks `is_manual = false`.
- When `p_document_type` is NULL (backward-compatible), it defaults to `is_manual = false` with `document_type = 'NT'`.
- This ensures every automated accounting entry gets a proper document type prefix.

### 2. New helper function: `get_next_document_number`
- Looks up the `accounting_documents` row for a given org + prefix.
- If it doesn't exist, auto-creates it (defaulting to 1).
- Returns the current `next_consecutive` and increments the counter atomically.
- SECURITY DEFINER so trigger functions can call it.

### 3. Update all accounting trigger functions
- `fn_invoice_accounting`: now assigns document type 'FV' (Factura de Venta) with sequential number.
- `fn_cash_entry_accounting`: assigns 'RC' for ingresos, 'CE' for egresos.
- `fn_product_inventory_accounting`: assigns 'NT' (Nota Contable) with sequential number.
- `fn_payment_accounting`: assigns 'RC' (Recibo de Caja) with sequential number.

### 4. Invoice cancellation support
- New columns on `invoices`:
  - `cancelled_at` (timestamptz, nullable) — timestamp when invoice was cancelled.
  - `cancelled_reason` (text, nullable) — reason for cancellation.
  - `cancelled_by` (uuid, nullable) — user ID who cancelled (references auth.users).
- New trigger `fn_invoice_cancellation` fires AFTER UPDATE when status changes to 'anulada'.
  - Posts a reversal journal entry with document type 'NC' (Nota Crédito) that mirrors the original entry with inverted debits/credits.
  - Restores product stock for all items on the cancelled invoice.

### 5. RLS
- No new tables — existing policies cover new columns on invoices.
- `invoices` already has UPDATE policy.

## Important Notes
- The `post_journal_entry` function signature change is backward-compatible: the new parameters are optional (default NULL).
- Existing triggers are replaced (CREATE OR REPLACE) to use the new function signature.
- Document numbering is atomic via row-level lock on `accounting_documents`.
- When an invoice is cancelled, stock is restored and a reversal accounting entry is posted automatically.
*/

-- ============================================================
-- Helper: get_next_document_number (atomic sequential numbering)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_next_document_number(p_org_id uuid, p_prefix text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_doc RECORD;
  v_number integer;
BEGIN
  SELECT id, next_consecutive INTO v_doc
  FROM public.accounting_documents
  WHERE organization_id = p_org_id AND prefix = p_prefix
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Auto-create the document config if it doesn't exist
    INSERT INTO public.accounting_documents (organization_id, prefix, label, next_consecutive)
    VALUES (p_org_id, p_prefix, p_prefix, 2)
    ON CONFLICT (organization_id, prefix) DO UPDATE SET next_consecutive = accounting_documents.next_consecutive
    RETURNING next_consecutive - 1 INTO v_number;
    RETURN v_number;
  END IF;

  v_number := v_doc.next_consecutive;

  UPDATE public.accounting_documents
  SET next_consecutive = v_number + 1, updated_at = now()
  WHERE id = v_doc.id;

  RETURN v_number;
END $func$;

-- ============================================================
-- Updated: post_journal_entry (with document type + number)
-- ============================================================
CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_org_id uuid,
  p_date date,
  p_description text,
  p_reference_type text,
  p_reference_id uuid,
  p_lines jsonb,
  p_document_type text DEFAULT NULL,
  p_document_number integer DEFAULT NULL
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
  v_doc_type text;
  v_doc_number integer;
BEGIN
  PERFORM public.ensure_default_accounts(p_org_id);

  v_doc_type := COALESCE(p_document_type, 'NT');
  IF p_document_number IS NOT NULL THEN
    v_doc_number := p_document_number;
  ELSE
    v_doc_number := public.get_next_document_number(p_org_id, v_doc_type);
  END IF;

  INSERT INTO public.journal_entries (organization_id, date, description, reference_type, reference_id, document_type, document_number, is_manual)
  VALUES (p_org_id, p_date, p_description, p_reference_type, p_reference_id, v_doc_type, v_doc_number, false)
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
-- Updated: fn_invoice_accounting (assigns FV document type)
-- ============================================================
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
  PERFORM public.post_journal_entry(NEW.organization_id, NEW.date, 'Factura ' || NEW.number, 'invoice', NEW.id, v_lines, 'FV');
  RETURN NEW;
END $func$;

-- ============================================================
-- Updated: fn_cash_entry_accounting (assigns RC/CE document type)
-- ============================================================
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
  v_doc_type text;
BEGIN
  PERFORM public.ensure_default_accounts(NEW.organization_id);
  IF NEW.type = 'ingreso' THEN
    v_caja_acc := public.get_mapping_account_id(NEW.organization_id, 'caja_ingreso');
    v_contra_acc := public.get_mapping_account_id(NEW.organization_id, 'caja_ingreso_contrapartida');
    v_doc_type := 'RC';
  ELSE
    v_caja_acc := public.get_mapping_account_id(NEW.organization_id, 'caja_egreso');
    v_contra_acc := public.get_mapping_account_id(NEW.organization_id, 'caja_egreso_contrapartida');
    v_doc_type := 'CE';
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
  PERFORM public.post_journal_entry(NEW.organization_id, NEW.date, NEW.concept, 'cash_entry', NEW.id, v_lines, v_doc_type);
  RETURN NEW;
END $func$;

-- ============================================================
-- Updated: fn_product_inventory_accounting (assigns NT document type)
-- ============================================================
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
    PERFORM public.post_journal_entry(NEW.organization_id, CURRENT_DATE, 'Registro de inventario: ' || NEW.name, 'product', NEW.id, v_lines, 'NT');
  ELSE
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_caja_acc, 'debit', v_abs_delta, 'credit', 0),
      jsonb_build_object('account_id', v_inv_acc, 'debit', 0, 'credit', v_abs_delta)
    );
    PERFORM public.post_journal_entry(NEW.organization_id, CURRENT_DATE, 'Salida de inventario: ' || NEW.name, 'product', NEW.id, v_lines, 'NT');
  END IF;
  RETURN NEW;
END $func$;

-- ============================================================
-- Updated: fn_payment_accounting (assigns RC document type)
-- ============================================================
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
  PERFORM public.post_journal_entry(NEW.organization_id, NEW.date, 'Recaudo cuota de administracion', 'payment', NEW.id, v_lines, 'RC');
  RETURN NEW;
END $func$;

-- ============================================================
-- Invoice cancellation columns
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'cancelled_at') THEN
    ALTER TABLE public.invoices ADD COLUMN cancelled_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'cancelled_reason') THEN
    ALTER TABLE public.invoices ADD COLUMN cancelled_reason text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'cancelled_by') THEN
    ALTER TABLE public.invoices ADD COLUMN cancelled_by uuid;
  END IF;
END $$;

-- ============================================================
-- Trigger: Invoice cancellation — reversal entry + stock restore
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_invoice_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_item RECORD;
  v_lines jsonb;
  v_caja_acc uuid;
  v_cartera_acc uuid;
  v_ventas_acc uuid;
  v_iva_acc uuid;
  v_cogs_acc uuid;
  v_cogs_inv_acc uuid;
  v_has_lines boolean := false;
BEGIN
  -- Only fire when status changes TO 'anulada'
  IF OLD.status <> 'anulada' AND NEW.status = 'anulada' THEN
    PERFORM public.ensure_default_accounts(NEW.organization_id);

    -- Restore product stock
    FOR v_item IN
      SELECT product_id, quantity FROM public.invoice_items WHERE invoice_id = NEW.id AND product_id IS NOT NULL
    LOOP
      UPDATE public.products
      SET stock = stock + v_item.quantity
      WHERE id = v_item.product_id;
    END LOOP;

    -- Build reversal entry (mirror original with swapped debit/credit)
    v_caja_acc := public.get_mapping_account_id(NEW.organization_id, 'venta_efectivo_caja');
    v_cartera_acc := public.get_mapping_account_id(NEW.organization_id, 'venta_credito_cartera');
    v_ventas_acc := public.get_mapping_account_id(NEW.organization_id, 'venta_efectivo_ingreso');
    v_iva_acc := public.get_mapping_account_id(NEW.organization_id, 'iva_recaudado');
    v_cogs_acc := public.get_mapping_account_id(NEW.organization_id, 'cogs_costo');
    v_cogs_inv_acc := public.get_mapping_account_id(NEW.organization_id, 'cogs_inventario');

    IF v_ventas_acc IS NOT NULL THEN
      IF NEW.payment_method = 'credito' THEN
        v_lines := jsonb_build_array(
          jsonb_build_object('account_id', v_ventas_acc, 'debit', NEW.subtotal, 'credit', 0),
          jsonb_build_object('account_id', COALESCE(v_cartera_acc, v_caja_acc), 'debit', 0, 'credit', NEW.total)
        );
      ELSE
        v_lines := jsonb_build_array(
          jsonb_build_object('account_id', v_ventas_acc, 'debit', NEW.subtotal, 'credit', 0),
          jsonb_build_object('account_id', v_caja_acc, 'debit', 0, 'credit', NEW.total)
        );
      END IF;
      v_has_lines := true;

      IF NEW.tax > 0 AND v_iva_acc IS NOT NULL THEN
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object('account_id', v_iva_acc, 'debit', NEW.tax, 'credit', 0)
        );
      END IF;

      IF v_cogs_acc IS NOT NULL AND v_cogs_inv_acc IS NOT NULL AND NEW.subtotal > 0 THEN
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object('account_id', v_cogs_inv_acc, 'debit', NEW.subtotal, 'credit', 0),
          jsonb_build_object('account_id', v_cogs_acc, 'debit', 0, 'credit', NEW.subtotal)
        );
      END IF;

      IF v_has_lines THEN
        PERFORM public.post_journal_entry(
          NEW.organization_id, NEW.date,
          'Anulacion factura ' || NEW.number,
          'invoice', NEW.id, v_lines, 'NC'
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $func$;

DROP TRIGGER IF EXISTS trg_invoice_cancellation ON public.invoices;
CREATE TRIGGER trg_invoice_cancellation
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_cancellation();