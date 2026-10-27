/*
# Add "costo_ventas" account type (Clase 6 — Costos / Costo de Ventas)

## Changes
1. Drops the existing accounts_type_check constraint.
2. Adds a new constraint that includes all existing types plus 'costo_ventas'.
3. This type is debit-nature (like gasto and costo), used for accounts
   starting with code 6 (Costo de Ventas / Costos in Colombian PUC).
*/

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_type_check;

ALTER TABLE public.accounts ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto', 'costo', 'costo_ventas', 'orden_deudora', 'orden_acreedora'));