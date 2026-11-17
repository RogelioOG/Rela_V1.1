/*
# Block deletion of invoices/dues with active payment receipts

1. Plain-English summary
- Source documents (charges per period and invoices) can no longer be deleted while active (non-voided) cash receipts have payments applied to them.
- A new lookup returns the receipts that block a period's deletion so the interface can show a clear alert.

2. New functions and triggers
- `guard_due_delete` (trigger on `dues`, BEFORE DELETE): raises a Spanish error listing up to 10 blocking receipt numbers when an active receipt has allocations for the due.
- `guard_invoice_delete` (trigger on `invoices`, BEFORE DELETE): same guard, resolved through the dues of the invoice's unit and period.
- `get_blocking_receipts_for_period(org, period)`: returns the active receipts that block deleting a billing period (receipt number, unit, payment date, total).

3. Security
- All functions are SECURITY INVOKER and respect existing row level security; execute is granted to authenticated only.
- Triggers run for every role, so bulk deletes from any client are blocked.

4. Important notes
- Voiding a receipt (status 'anulado') releases the balances and the guard stops blocking, which enables deleting the source documents afterwards.
*/

CREATE OR REPLACE FUNCTION public.guard_due_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_list text;
BEGIN
  SELECT string_agg(t.receipt_number, ', ')
    INTO v_list
    FROM (
      SELECT DISTINCT r.receipt_number
      FROM public.receipt_allocations ra
      JOIN public.receipts r ON r.id = ra.receipt_id
      WHERE ra.due_id = OLD.id AND r.status <> 'anulado'
      LIMIT 10
    ) t;

  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede eliminar la obligación del período %: tiene pagos aplicados en los recibos de caja %. Anule o elimine primero esos recibos para liberar los saldos.', OLD.period, v_list;
  END IF;

  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_invoice_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_list text;
BEGIN
  SELECT string_agg(t.receipt_number, ', ')
    INTO v_list
    FROM (
      SELECT DISTINCT r.receipt_number
      FROM public.receipt_allocations ra
      JOIN public.receipts r ON r.id = ra.receipt_id
      JOIN public.dues d ON d.id = ra.due_id
      WHERE d.unit_id = OLD.unit_id AND d.period = OLD.period AND r.status <> 'anulado'
      LIMIT 10
    ) t;

  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede eliminar la cuenta de cobro del período %: la unidad tiene pagos aplicados en los recibos de caja %. Anule o elimine primero esos recibos para liberar los saldos.', OLD.period, v_list;
  END IF;

  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_dues_block_delete ON public.dues;
CREATE TRIGGER trg_dues_block_delete
BEFORE DELETE ON public.dues
FOR EACH ROW EXECUTE FUNCTION public.guard_due_delete();

DROP TRIGGER IF EXISTS trg_invoices_block_delete ON public.invoices;
CREATE TRIGGER trg_invoices_block_delete
BEFORE DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_delete();

CREATE OR REPLACE FUNCTION public.get_blocking_receipts_for_period(p_organization_id uuid, p_period text)
RETURNS TABLE (
  receipt_id uuid,
  receipt_number text,
  tower text,
  unit_label text,
  payment_date date,
  total_amount numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
SELECT DISTINCT r.id, r.receipt_number, u.tower, u.unit_label, r.payment_date, r.total_amount
FROM public.receipts r
JOIN public.receipt_allocations ra ON ra.receipt_id = r.id
JOIN public.dues d ON d.id = ra.due_id
JOIN public.units u ON u.id = r.unit_id
WHERE r.organization_id = p_organization_id
  AND d.organization_id = p_organization_id
  AND d.period = p_period
  AND r.status <> 'anulado'
ORDER BY r.receipt_number;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_blocking_receipts_for_period(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_blocking_receipts_for_period(uuid, text) TO authenticated;
