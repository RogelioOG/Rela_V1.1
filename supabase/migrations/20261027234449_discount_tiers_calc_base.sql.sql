/*
# Discount Tiers — Add Calculation Base Concepts

## Purpose
Allow percentage-type discount tiers to specify which active billing concepts
serve as the calculation base (the set of concept amounts the percentage applies to).
Also supports "Valor Total" (all concepts) as an option.

## Changes
1. Add `calculation_base_concept_ids` (uuid[]) to `discount_tiers` — nullable array of
   billing_concept IDs. When NULL or empty, the base is "Valor Total" (all concepts).
2. No RLS changes — existing policies on discount_tiers already use has_org_access.
*/

ALTER TABLE public.discount_tiers
  ADD COLUMN IF NOT EXISTS calculation_base_concept_ids uuid[] DEFAULT '{}';
