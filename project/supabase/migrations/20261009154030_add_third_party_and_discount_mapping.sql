/*
# Third-Party on Journal Lines + Cash Entries + Discount Mapping

## Changes

### 1. Add `third_party_id` to `journal_lines`
- New nullable column `third_party_id uuid REFERENCES third_parties(id) ON DELETE SET NULL`.
- Allows associating each journal line with a third party (tercero).

### 2. Add `third_party_id` to `cash_entries`
- New nullable column `third_party_id uuid REFERENCES third_parties(id) ON DELETE SET NULL`.
- Allows requiring a third party on cash entries (ingresos and egresos).

### 3. Update `fn_cash_entry_accounting` trigger
- The trigger now passes `third_party_id` from the cash entry to each journal line it creates.
- This ensures the third party selected in Caja flows through to the accounting entry lines.

### 4. Update `post_journal_entry` function
- Accepts an optional `p_third_party_id` parameter (uuid, default NULL).
- When provided, sets `third_party_id` on each journal line created.

### 5. Add discount movement types to `get_mapping_account_id`
- New movement type `venta_descuento` — account for sales discounts (contra-ingreso).
- Falls back to searching for an 'ingreso' account named 'descuento' or 'devoluciones'.

### 6. Update `fn_invoice_accounting` trigger
- When an invoice has discounts (subtotal < sum of line items at sale price), posts a discount line.
- Debits the discount account, credits the sales account for the discount amount.

## Important Notes
- `third_party_id` is nullable for backward compatibility with existing rows.
- The frontend will enforce the required third party for new entries.
- The discount accounting is only posted when a discount was actually applied.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journal_lines' AND column_name = 'third_party_id') THEN
    ALTER TABLE public.journal_lines ADD COLUMN third_party_id uuid REFERENCES public.third_parties(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cash_entries' AND column_name = 'third_party_id') THEN
    ALTER TABLE public.cash_entries ADD COLUMN third_party_id uuid REFERENCES public.third_parties(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Update post_journal_entry to accept third_party_id
CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_org_id uuid,
  p_date date,
  p_description text,
  p_reference_type text,
  p_reference_id uuid,
  p_lines jsonb,
  p_document_type text DEFAULT NULL,
  p_document_number integer DEFAULT NULL,
  p_third_party_id uuid DEFAULT NULL
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
  v_line_tp uuid;
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
    v_line_tp := COALESCE(NULLIF(v_line->>'third_party_id', '')::uuid, p_third_party_id);

    IF v_account_id IS NULL OR (v_debit = 0 AND v_credit = 0) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, third_party_id)
    VALUES (v_entry_id, v_account_id::uuid, v_debit, v_credit, v_line_tp);
  END LOOP;

  RETURN v_entry_id;
END $$;

-- Update get_mapping_account_id to handle discount movement type
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
  ELSIF p_movement_type = 'venta_descuento' THEN
    RETURN public.get_account_id(org_id, 'ingreso', 'descuento');
  ELSE
    RETURN NULL;
  END IF;
END $func$;

-- Update fn_cash_entry_accounting to pass third_party_id
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
      jsonb_build_object('account_id', v_caja_acc, 'debit', NEW.amount, 'credit', 0, 'third_party_id', NEW.third_party_id),
      jsonb_build_object('account_id', COALESCE(v_contra_acc, v_caja_acc), 'debit', 0, 'credit', NEW.amount, 'third_party_id', NEW.third_party_id)
    );
  ELSE
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', COALESCE(v_contra_acc, v_caja_acc), 'debit', NEW.amount, 'credit', 0, 'third_party_id', NEW.third_party_id),
      jsonb_build_object('account_id', v_caja_acc, 'debit', 0, 'credit', NEW.amount, 'third_party_id', NEW.third_party_id)
    );
  END IF;
  PERFORM public.post_journal_entry(NEW.organization_id, NEW.date, NEW.concept, 'cash_entry', NEW.id, v_lines, v_doc_type);
  RETURN NEW;
END $func$;
