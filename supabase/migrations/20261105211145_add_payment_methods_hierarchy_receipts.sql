/*
# Payment methods, payment hierarchy, and cash receipts (Module 06 - Prompt 1)

Plain-English summary: adds the database foundation for recording payments. It lets each
organization define how money is received (for example cash or bank transfer), set the order in
which charge concepts are paid, and store cash receipts with their per-charge allocations.

## 1. Modified tables
- `billing_concepts`: new nullable column `advance_account_id` that points to the accounting
  account used to hold advance payments (anticipos) for that concept.

## 2. New tables
- `payment_methods` (Metodos de pago): name, linked accounting account and active flag, per organization.
- `payment_hierarchy_configs` (Jerarquia de pagos): ordered priority of billing concepts per organization.
- `receipts` (Recibos de caja, header): one receipt per unit and payment, with amounts, dates,
  payment method, notes and status (defaults to 'contabilizado').
- `receipt_allocations` (Detalle del recibo): how each receipt amount was applied to a due and
  concept (capital, interest and discount applied).

## 3. Security
- Row Level Security is enabled on all four new tables.
- Access is limited to signed-in users with access to the organization (via the existing
  `has_org_access` helper, which also grants master users access).
- Each table has four separate policies (select, insert, update, delete). No anonymous access.
- `receipt_allocations` has no organization column, so its policies check the organization of the
  parent receipt.
- Table privileges are granted only to the `authenticated` role.

## 4. Important notes
- Deleting an organization cascades to its payment methods, hierarchy configs and receipts.
- Deleting a receipt cascades to its allocations. Deleting a due cascades to allocations that point to it.
- Amount columns use NUMERIC(12,2) and default to 0 where specified.
*/

ALTER TABLE billing_concepts
  ADD COLUMN IF NOT EXISTS advance_account_id uuid REFERENCES accounts(id);

CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  account_id uuid REFERENCES accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_hierarchy_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  concept_id uuid NOT NULL REFERENCES billing_concepts(id) ON DELETE CASCADE,
  priority_order integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  receipt_number text,
  payment_date date,
  accounting_date date,
  payment_method_id uuid REFERENCES payment_methods(id),
  total_amount numeric(12,2),
  applied_amount numeric(12,2),
  advance_amount numeric(12,2) DEFAULT 0,
  notes text,
  status text DEFAULT 'contabilizado',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  due_id uuid NOT NULL REFERENCES dues(id) ON DELETE CASCADE,
  concept_id uuid REFERENCES billing_concepts(id),
  capital_applied numeric(12,2) DEFAULT 0,
  interest_applied numeric(12,2) DEFAULT 0,
  discount_applied numeric(12,2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_organization_id ON payment_methods(organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_hierarchy_configs_organization_id ON payment_hierarchy_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_hierarchy_configs_concept_id ON payment_hierarchy_configs(concept_id);
CREATE INDEX IF NOT EXISTS idx_receipts_organization_unit ON receipts(organization_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_receipts_payment_method_id ON receipts(payment_method_id);
CREATE INDEX IF NOT EXISTS idx_receipt_allocations_receipt_id ON receipt_allocations(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_allocations_due_id ON receipt_allocations(due_id);
CREATE INDEX IF NOT EXISTS idx_receipt_allocations_concept_id ON receipt_allocations(concept_id);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_hierarchy_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_allocations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON payment_methods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_hierarchy_configs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON receipts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON receipt_allocations TO authenticated;

DROP POLICY IF EXISTS "pm_select_org" ON payment_methods;
CREATE POLICY "pm_select_org" ON payment_methods FOR SELECT
  TO authenticated USING (has_org_access(organization_id));

DROP POLICY IF EXISTS "pm_insert_org" ON payment_methods;
CREATE POLICY "pm_insert_org" ON payment_methods FOR INSERT
  TO authenticated WITH CHECK (has_org_access(organization_id));

DROP POLICY IF EXISTS "pm_update_org" ON payment_methods;
CREATE POLICY "pm_update_org" ON payment_methods FOR UPDATE
  TO authenticated USING (has_org_access(organization_id)) WITH CHECK (has_org_access(organization_id));

DROP POLICY IF EXISTS "pm_delete_org" ON payment_methods;
CREATE POLICY "pm_delete_org" ON payment_methods FOR DELETE
  TO authenticated USING (has_org_access(organization_id));

DROP POLICY IF EXISTS "phc_select_org" ON payment_hierarchy_configs;
CREATE POLICY "phc_select_org" ON payment_hierarchy_configs FOR SELECT
  TO authenticated USING (has_org_access(organization_id));

DROP POLICY IF EXISTS "phc_insert_org" ON payment_hierarchy_configs;
CREATE POLICY "phc_insert_org" ON payment_hierarchy_configs FOR INSERT
  TO authenticated WITH CHECK (has_org_access(organization_id));

DROP POLICY IF EXISTS "phc_update_org" ON payment_hierarchy_configs;
CREATE POLICY "phc_update_org" ON payment_hierarchy_configs FOR UPDATE
  TO authenticated USING (has_org_access(organization_id)) WITH CHECK (has_org_access(organization_id));

DROP POLICY IF EXISTS "phc_delete_org" ON payment_hierarchy_configs;
CREATE POLICY "phc_delete_org" ON payment_hierarchy_configs FOR DELETE
  TO authenticated USING (has_org_access(organization_id));

DROP POLICY IF EXISTS "receipts_select_org" ON receipts;
CREATE POLICY "receipts_select_org" ON receipts FOR SELECT
  TO authenticated USING (has_org_access(organization_id));

DROP POLICY IF EXISTS "receipts_insert_org" ON receipts;
CREATE POLICY "receipts_insert_org" ON receipts FOR INSERT
  TO authenticated WITH CHECK (has_org_access(organization_id));

DROP POLICY IF EXISTS "receipts_update_org" ON receipts;
CREATE POLICY "receipts_update_org" ON receipts FOR UPDATE
  TO authenticated USING (has_org_access(organization_id)) WITH CHECK (has_org_access(organization_id));

DROP POLICY IF EXISTS "receipts_delete_org" ON receipts;
CREATE POLICY "receipts_delete_org" ON receipts FOR DELETE
  TO authenticated USING (has_org_access(organization_id));

DROP POLICY IF EXISTS "ra_select_org" ON receipt_allocations;
CREATE POLICY "ra_select_org" ON receipt_allocations FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM receipts r WHERE r.id = receipt_allocations.receipt_id AND has_org_access(r.organization_id))
  );

DROP POLICY IF EXISTS "ra_insert_org" ON receipt_allocations;
CREATE POLICY "ra_insert_org" ON receipt_allocations FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM receipts r WHERE r.id = receipt_allocations.receipt_id AND has_org_access(r.organization_id))
  );

DROP POLICY IF EXISTS "ra_update_org" ON receipt_allocations;
CREATE POLICY "ra_update_org" ON receipt_allocations FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM receipts r WHERE r.id = receipt_allocations.receipt_id AND has_org_access(r.organization_id))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM receipts r WHERE r.id = receipt_allocations.receipt_id AND has_org_access(r.organization_id))
  );

DROP POLICY IF EXISTS "ra_delete_org" ON receipt_allocations;
CREATE POLICY "ra_delete_org" ON receipt_allocations FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM receipts r WHERE r.id = receipt_allocations.receipt_id AND has_org_access(r.organization_id))
  );
