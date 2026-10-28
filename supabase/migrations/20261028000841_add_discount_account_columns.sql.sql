/*
# Add discount accounting columns to billing_concepts

1. Modified Tables
- `billing_concepts`: Added `discount_income_account_id` and `discount_counterpart_account_id`
  (uuid, nullable, FK to accounts). These columns store the dedicated accounting accounts
  for recording discount entries (descuentos por pronto pago) separately from the concept's
  regular income/counterpart accounts.

2. Security
- No new tables. Existing RLS policies on billing_concepts cover the new columns
  since they are updated through the same UPDATE policy.
- No new grants needed — the existing grants on billing_concepts cover all columns.
*/

ALTER TABLE public.billing_concepts
  ADD COLUMN IF NOT EXISTS discount_income_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_counterpart_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;