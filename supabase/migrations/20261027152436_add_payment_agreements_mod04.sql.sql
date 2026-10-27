/*
# MOD-04: Acuerdos de Pago — payment_agreements table

## Purpose
Stores payment agreements (acuerdos de pago) for delinquent properties in
Propiedad Horizontal organizations. Each agreement records a structured
monthly installment plan to settle outstanding balances over a defined period.

## 1. New Table: payment_agreements
- `id` (uuid, PK)
- `organization_id` (uuid, FK -> organizations) — scoping column
- `unit_id` (uuid, FK -> units) — the property the agreement covers
- `start_period` (text, YYYY-MM) — first installment period
- `end_period` (text, YYYY-MM) — last installment period
- `months` (integer) — total number of monthly installments
- `monthly_amount` (numeric) — fixed monthly payment amount in COP
- `total_amount` (numeric, generated) — monthly_amount * months, stored for reporting
- `status` (text, check: 'en_cumplimiento' | 'incumplido' | 'finalizado') — agreement lifecycle
- `notes` (text, nullable) — optional internal notes
- `is_active` (boolean, default true) — soft-delete / archival flag
- `created_at` / `updated_at` (timestamptz)

## 2. Security
- RLS enabled on payment_agreements.
- Grants: SELECT, INSERT, UPDATE, DELETE to `authenticated` only (this app has sign-in).
- 4 owner-scoped policies via organization membership check through `units` ownership.
  Since `units` already enforces org-scoped access, we scope payment_agreements
  through the organization_id matching the user's active org membership.
  Uses a simple `organization_id` check against user_organizations.
*/

CREATE TABLE IF NOT EXISTS payment_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  start_period text NOT NULL,
  end_period text NOT NULL,
  months integer NOT NULL CHECK (months > 0),
  monthly_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  total_amount numeric(14,2) GENERATED ALWAYS AS (monthly_amount * months) STORED,
  status text NOT NULL DEFAULT 'en_cumplimiento' CHECK (status IN ('en_cumplimiento', 'incumplido', 'finalizado')),
  notes text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE payment_agreements ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_payment_agreements_org ON payment_agreements(organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_agreements_unit ON payment_agreements(unit_id);
CREATE INDEX IF NOT EXISTS idx_payment_agreements_status ON payment_agreements(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON payment_agreements TO authenticated;

DROP POLICY IF EXISTS "select_own_payment_agreements" ON payment_agreements;
CREATE POLICY "select_own_payment_agreements"
ON payment_agreements FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_organizations uo
    WHERE uo.organization_id = payment_agreements.organization_id
    AND uo.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "insert_own_payment_agreements" ON payment_agreements;
CREATE POLICY "insert_own_payment_agreements"
ON payment_agreements FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_organizations uo
    WHERE uo.organization_id = payment_agreements.organization_id
    AND uo.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "update_own_payment_agreements" ON payment_agreements;
CREATE POLICY "update_own_payment_agreements"
ON payment_agreements FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_organizations uo
    WHERE uo.organization_id = payment_agreements.organization_id
    AND uo.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_organizations uo
    WHERE uo.organization_id = payment_agreements.organization_id
    AND uo.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "delete_own_payment_agreements" ON payment_agreements;
CREATE POLICY "delete_own_payment_agreements"
ON payment_agreements FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_organizations uo
    WHERE uo.organization_id = payment_agreements.organization_id
    AND uo.user_id = auth.uid()
  )
);
