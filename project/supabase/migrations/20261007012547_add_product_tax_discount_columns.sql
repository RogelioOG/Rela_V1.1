/*
# Product Tax & Discount Enhancements

## Changes

1. New columns on `products`:
   - `tax_enabled` (boolean, default false) — whether tax applies to this product.
   - `tax_rate` (numeric, default 19) — the tax percentage. Defaults to 19 (IVA).
   - `tax_name` (text, default 'IVA') — name of the tax. Allows custom tax names.
   - `discount_enabled` (boolean, default false) — whether a discount applies.
   - `discount_type` (text: 'porcentaje' | 'monto', default 'porcentaje') — discount calculation method.
   - `discount_value` (numeric, default 0) — the discount amount or percentage.
   - `discount_start_date` (date, nullable) — when the discount becomes active.
   - `discount_end_date` (date, nullable) — when the discount expires. NULL = indefinite.

2. New column on `invoice_items`:
   - `tax_rate` (numeric, default 0) — the tax rate applied to this line item.
   - `tax_amount` (numeric, default 0) — the tax amount for this line.
   - `discount_amount` (numeric, default 0) — the discount amount for this line.

3. No new RLS policies needed — existing policies cover the new columns.

## Important Notes
- tax_rate defaults to 19 (standard Colombian IVA) but can be customized per product.
- discount_start_date and discount_end_date are both nullable: both NULL means indefinite.
- The POS will check whether today's date falls within the discount range before applying.
*/
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'tax_enabled') THEN
    ALTER TABLE public.products ADD COLUMN tax_enabled boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'tax_rate') THEN
    ALTER TABLE public.products ADD COLUMN tax_rate numeric(5,2) NOT NULL DEFAULT 19;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'tax_name') THEN
    ALTER TABLE public.products ADD COLUMN tax_name text NOT NULL DEFAULT 'IVA';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'discount_enabled') THEN
    ALTER TABLE public.products ADD COLUMN discount_enabled boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'discount_type') THEN
    ALTER TABLE public.products ADD COLUMN discount_type text NOT NULL DEFAULT 'porcentaje' CHECK (discount_type IN ('porcentaje', 'monto'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'discount_value') THEN
    ALTER TABLE public.products ADD COLUMN discount_value numeric(14,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'discount_start_date') THEN
    ALTER TABLE public.products ADD COLUMN discount_start_date date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'discount_end_date') THEN
    ALTER TABLE public.products ADD COLUMN discount_end_date date;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'tax_rate') THEN
    ALTER TABLE public.invoice_items ADD COLUMN tax_rate numeric(5,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'tax_amount') THEN
    ALTER TABLE public.invoice_items ADD COLUMN tax_amount numeric(14,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_items' AND column_name = 'discount_amount') THEN
    ALTER TABLE public.invoice_items ADD COLUMN discount_amount numeric(14,2) NOT NULL DEFAULT 0;
  END IF;
END $$;
