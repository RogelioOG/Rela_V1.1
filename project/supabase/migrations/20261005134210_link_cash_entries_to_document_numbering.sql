/*
# Link Caja y Egresos to Accounting Document Numbering

## Changes

1. New columns on `cash_entries`:
   - `document_type` (text) — the accounting document prefix: 'RC' for ingresos, 'CE' for egresos.
   - `document_number` (integer) — the consecutive number assigned from the accounting_documents sequence.

2. Backfill existing cash_entries rows:
   - Existing ingresos get document_type = 'RC', existing egresos get document_type = 'CE'.
   - document_number is left NULL for existing rows (they predate the sequence).

3. No new RLS policies needed — cash_entries already has full CRUD policies.

## Important Notes
- When a new cash entry is created, the frontend will look up the appropriate
  accounting_documents row (RC for ingreso, CE for egreso), use next_consecutive
  as the document_number, and then increment the sequence.
- This ensures Caja y Egresos shares the same numbering system configured in
  the Documentos Contables tab without duplicating logic.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cash_entries' AND column_name = 'document_type') THEN
    ALTER TABLE public.cash_entries ADD COLUMN document_type text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cash_entries' AND column_name = 'document_number') THEN
    ALTER TABLE public.cash_entries ADD COLUMN document_number integer;
  END IF;
END $$;

-- Backfill existing rows
UPDATE public.cash_entries SET document_type = 'RC' WHERE document_type IS NULL AND type = 'ingreso';
UPDATE public.cash_entries SET document_type = 'CE' WHERE document_type IS NULL AND type = 'egreso';
