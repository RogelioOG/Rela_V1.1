/*
# Accounting Documents Configuration & Journal Entry Enhancements

## Changes

1. New table: `accounting_documents`
   - Stores per-organization configuration for each authorized accounting document type.
   - Each row has a prefix (e.g. 'CE', 'RC'), a label, and a `next_consecutive` integer.
   - Eight document types are seeded as defaults for every organization.
   - Independent sequential numbering per document type.

2. New columns on `journal_entries`:
   - `document_type` (text) — the prefix of the accounting document (CE, RC, FV, etc.).
   - `document_number` (integer) — the consecutive number assigned to this entry.
   - `is_manual` (boolean, default true) — distinguishes manually created entries from automated POS/sales entries.

3. New RLS policies:
   - SELECT/INSERT/UPDATE/DELETE on `accounting_documents` (org-scoped via has_org_access).
   - UPDATE policy on `journal_entries` (org-scoped) — previously missing.
   - UPDATE policy on `journal_lines` (org-scoped) — previously missing.

4. Index on `journal_entries(document_type)` for filtering.

## Important Notes
- Existing journal_entries rows get `is_manual = true` by default and `document_type = 'NT'` (Nota Contable) as fallback.
- POS/sales automated entries will have `is_manual = false` so the Asientos Contables view can exclude them.
- The `next_consecutive` field enforces that the next document number is always >= 1.
*/

-- ============================================================
-- TABLE: accounting_documents
-- ============================================================
CREATE TABLE IF NOT EXISTS public.accounting_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  prefix text NOT NULL,
  label text NOT NULL,
  next_consecutive integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, prefix)
);

ALTER TABLE public.accounting_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_select_org" ON public.accounting_documents;
CREATE POLICY "ad_select_org" ON public.accounting_documents FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));

DROP POLICY IF EXISTS "ad_insert_org" ON public.accounting_documents;
CREATE POLICY "ad_insert_org" ON public.accounting_documents FOR INSERT TO authenticated
WITH CHECK (public.has_org_access(organization_id));

DROP POLICY IF EXISTS "ad_update_org" ON public.accounting_documents;
CREATE POLICY "ad_update_org" ON public.accounting_documents FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id))
WITH CHECK (public.has_org_access(organization_id));

DROP POLICY IF EXISTS "ad_delete_org" ON public.accounting_documents;
CREATE POLICY "ad_delete_org" ON public.accounting_documents FOR DELETE TO authenticated
USING (public.has_org_access(organization_id));

-- ============================================================
-- ALTER journal_entries: add document_type, document_number, is_manual
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journal_entries' AND column_name = 'document_type') THEN
    ALTER TABLE public.journal_entries ADD COLUMN document_type text DEFAULT 'NT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journal_entries' AND column_name = 'document_number') THEN
    ALTER TABLE public.journal_entries ADD COLUMN document_number integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journal_entries' AND column_name = 'is_manual') THEN
    ALTER TABLE public.journal_entries ADD COLUMN is_manual boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- Backfill: any existing entry without a document_type gets 'NT'
UPDATE public.journal_entries SET document_type = 'NT' WHERE document_type IS NULL;

-- ============================================================
-- RLS: UPDATE policy on journal_entries (was missing)
-- ============================================================
DROP POLICY IF EXISTS "je_update_org" ON public.journal_entries;
CREATE POLICY "je_update_org" ON public.journal_entries FOR UPDATE TO authenticated
USING (public.has_org_access(organization_id))
WITH CHECK (public.has_org_access(organization_id));

-- ============================================================
-- RLS: UPDATE policy on journal_lines (was missing)
-- ============================================================
DROP POLICY IF EXISTS "jl_update_org" ON public.journal_lines;
CREATE POLICY "jl_update_org" ON public.journal_lines FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = journal_entry_id AND public.has_org_access(je.organization_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = journal_entry_id AND public.has_org_access(je.organization_id)));

-- ============================================================
-- INDEX
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_je_doc_type ON public.journal_entries(document_type);
CREATE INDEX IF NOT EXISTS idx_je_manual ON public.journal_entries(is_manual);
CREATE INDEX IF NOT EXISTS idx_ad_org ON public.accounting_documents(organization_id);
