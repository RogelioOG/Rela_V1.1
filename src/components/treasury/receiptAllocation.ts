import type { Due, PaymentHierarchyConfig } from '@/lib/supabase';

export interface AllocationAmounts {
  capital: number;
  interest: number;
}

export interface AllocationResult {
  amounts: Record<string, AllocationAmounts>;
  conceptId: string | null;
  applied: number;
  advance: number;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseAmount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function topPriorityConceptId(hierarchy: PaymentHierarchyConfig[]): string | null {
  const ranked = hierarchy
    .filter(h => h.priority_order !== null && !h.billing_concept?.is_late_interest)
    .sort((a, b) => (a.priority_order ?? 0) - (b.priority_order ?? 0));
  return ranked[0]?.concept_id ?? null;
}

export function allocateReceipt(
  dues: Due[],
  hierarchy: PaymentHierarchyConfig[],
  total: number,
): AllocationResult {
  const conceptId = topPriorityConceptId(hierarchy);
  const oldestFirst = [...dues].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const amounts: Record<string, AllocationAmounts> = {};

  let remaining = roundMoney(Math.max(total, 0));
  for (const due of oldestFirst) {
    const pay = roundMoney(Math.min(remaining, Math.max(due.balance, 0)));
    amounts[due.id] = { capital: pay, interest: 0 };
    remaining = roundMoney(remaining - pay);
  }

  const applied = roundMoney(Math.max(total, 0) - remaining);
  return { amounts, conceptId, applied, advance: remaining };
}
