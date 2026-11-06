/*
# Save receipt (recibo de caja) atomically

1. Plain-English summary
- Adds a database function `save_receipt` that records a cash receipt in one transaction.
- It validates the receipt, assigns the next sequential number (RC-0001, RC-0002, ...), stores the header and the per-due allocations, reduces the balance of each affected due, and posts a balanced journal voucher.

2. Function behaviour
- Rejects closed accounting periods.
- Requires an active payment method with a linked account.
- Requires every allocated due to belong to the selected unit, be pending or partially paid, and have enough balance for the capital applied.
- Any amount above the allocated total is recorded as advance (anticipo / saldo a favor) and credited to the advance account of the default billing concept.
- Journal voucher: debit the payment method account for the total received; credit the receivables account (venta_credito_cartera mapping) for the applied amount; credit the advance account for any overpayment.

3. Security
- SECURITY INVOKER: all reads and writes run under the caller's row level security policies, plus an explicit organization access check.
- Execute is revoked from PUBLIC and anon and granted to authenticated only.

4. Important notes
- Interest applied is recorded on the allocation but does not reduce the due balance, since dues store capital balance only.
- Receipt numbers share the RC document sequence used by the journal, so they stay aligned.
*/

CREATE OR REPLACE FUNCTION public.save_receipt(
  p_organization_id uuid,
  p_unit_id uuid,
  p_payment_date date,
  p_accounting_date date,
  p_payment_method_id uuid,
  p_total_amount numeric,
  p_notes text,
  p_allocations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_method payment_methods%ROWTYPE;
  v_unit units%ROWTYPE;
  v_due dues%ROWTYPE;
  v_alloc jsonb;
  v_capital numeric;
  v_interest numeric;
  v_applied numeric := 0;
  v_advance numeric;
  v_seq integer;
  v_receipt_id uuid;
  v_receipt_number text;
  v_entry_id uuid;
  v_cartera_acc uuid;
  v_advance_acc uuid;
  v_concept_id uuid;
  v_lines jsonb;
BEGIN
  IF NOT public.has_org_access(p_organization_id) THEN
    RAISE EXCEPTION 'No tiene acceso a esta organización';
  END IF;

  IF p_total_amount IS NULL OR p_total_amount <= 0 THEN
    RAISE EXCEPTION 'El valor recibido debe ser mayor a cero';
  END IF;

  IF p_payment_date IS NULL OR p_accounting_date IS NULL THEN
    RAISE EXCEPTION 'Las fechas de pago y contable son obligatorias';
  END IF;

  IF public.is_period_closed(p_organization_id, p_accounting_date) THEN
    RAISE EXCEPTION 'El período contable de la fecha % está cerrado', p_accounting_date;
  END IF;

  SELECT * INTO v_method
  FROM public.payment_methods
  WHERE id = p_payment_method_id AND organization_id = p_organization_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El método de pago no existe o está inactivo';
  END IF;
  IF v_method.account_id IS NULL THEN
    RAISE EXCEPTION 'El método de pago no tiene una cuenta contable asociada';
  END IF;

  SELECT * INTO v_unit FROM public.units
  WHERE id = p_unit_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La unidad seleccionada no existe';
  END IF;

  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'Debe asignar el recibo a al menos una obligación pendiente';
  END IF;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    v_capital := COALESCE((v_alloc->>'capital_applied')::numeric, 0);
    v_interest := COALESCE((v_alloc->>'interest_applied')::numeric, 0);

    IF v_capital < 0 OR v_interest < 0 THEN
      RAISE EXCEPTION 'Los valores aplicados no pueden ser negativos';
    END IF;
    IF v_capital + v_interest = 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_due FROM public.dues
    WHERE id = (v_alloc->>'due_id')::uuid
      AND organization_id = p_organization_id
      AND unit_id = p_unit_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Una de las obligaciones no pertenece a la unidad seleccionada';
    END IF;
    IF v_due.status NOT IN ('pendiente', 'parcial') THEN
      RAISE EXCEPTION 'La obligación del período % ya no tiene saldo pendiente', v_due.period;
    END IF;
    IF v_capital > v_due.balance THEN
      RAISE EXCEPTION 'El valor a capital supera el saldo pendiente del período %', v_due.period;
    END IF;

    v_applied := v_applied + v_capital + v_interest;
  END LOOP;

  IF v_applied > p_total_amount THEN
    RAISE EXCEPTION 'El valor aplicado a las obligaciones supera el total recibido';
  END IF;

  v_advance := p_total_amount - v_applied;

  v_cartera_acc := public.get_mapping_account_id(p_organization_id, 'venta_credito_cartera');
  IF v_cartera_acc IS NULL THEN
    RAISE EXCEPTION 'No hay cuenta de cartera configurada para la organización';
  END IF;

  IF v_advance > 0 THEN
    SELECT advance_account_id INTO v_advance_acc
    FROM public.billing_concepts
    WHERE organization_id = p_organization_id AND is_default AND advance_account_id IS NOT NULL
    LIMIT 1;
    IF v_advance_acc IS NULL THEN
      RAISE EXCEPTION 'Configure la cuenta de anticipo en el concepto por defecto para registrar saldos a favor';
    END IF;
  END IF;

  v_seq := public.get_next_document_number(p_organization_id, 'RC');
  v_receipt_number := 'RC-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.receipts (
    organization_id, unit_id, receipt_number, payment_date, accounting_date,
    payment_method_id, total_amount, applied_amount, advance_amount, notes, status
  ) VALUES (
    p_organization_id, p_unit_id, v_receipt_number, p_payment_date, p_accounting_date,
    p_payment_method_id, p_total_amount, v_applied, v_advance, NULLIF(trim(COALESCE(p_notes, '')), ''), 'contabilizado'
  )
  RETURNING id INTO v_receipt_id;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    v_capital := COALESCE((v_alloc->>'capital_applied')::numeric, 0);
    v_interest := COALESCE((v_alloc->>'interest_applied')::numeric, 0);
    IF v_capital + v_interest = 0 THEN
      CONTINUE;
    END IF;

    v_concept_id := NULLIF(v_alloc->>'concept_id', '')::uuid;
    IF v_concept_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.billing_concepts
      WHERE id = v_concept_id AND organization_id = p_organization_id
    ) THEN
      RAISE EXCEPTION 'El concepto seleccionado no pertenece a la organización';
    END IF;

    INSERT INTO public.receipt_allocations (
      receipt_id, due_id, concept_id, capital_applied, interest_applied, discount_applied
    ) VALUES (
      v_receipt_id, (v_alloc->>'due_id')::uuid, v_concept_id, v_capital, v_interest, 0
    );

    UPDATE public.dues
    SET balance = GREATEST(0, balance - v_capital),
        status = CASE
          WHEN v_capital = 0 THEN status
          WHEN balance - v_capital <= 0 THEN 'pagada'
          ELSE 'parcial'
        END
    WHERE id = (v_alloc->>'due_id')::uuid;
  END LOOP;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_method.account_id, 'debit', p_total_amount, 'credit', 0),
    jsonb_build_object('account_id', v_cartera_acc, 'debit', 0, 'credit', v_applied)
  );
  IF v_advance > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_advance_acc, 'debit', 0, 'credit', v_advance)
    );
  END IF;

  v_entry_id := public.post_journal_entry(
    p_organization_id,
    p_accounting_date,
    'Recibo de caja ' || v_receipt_number,
    'receipt',
    v_receipt_id,
    v_lines,
    'RC',
    v_seq,
    v_unit.third_party_id
  );

  RETURN jsonb_build_object(
    'id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'journal_entry_id', v_entry_id
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.save_receipt(uuid, uuid, date, date, uuid, numeric, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_receipt(uuid, uuid, date, date, uuid, numeric, text, jsonb) TO authenticated;
