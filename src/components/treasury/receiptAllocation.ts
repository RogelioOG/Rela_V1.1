import type { Due, PaymentHierarchyConfig, BillingConcept } from '@/lib/supabase';

export interface DetailedDueItem {
  id: string; // Identificador único de la línea (dueId + conceptId)
  dueId: string;
  period: string;
  dueDate: string;
  conceptId: string;
  conceptCode: string;
  conceptName: string;
  balance: number;
  priorityOrder: number;
  isInterest: boolean;
  eligibleForDiscount: boolean;
  discountAmount: number;
}

export interface AllocationAmounts {
  applied: number;
}

export interface AllocationResult {
  amounts: Record<string, AllocationAmounts>;
  appliedTotal: number;
  advanceTotal: number;
  items: DetailedDueItem[];
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseAmount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

/**
 * Desglosa las deudas por concepto individual y las ordena:
 * 1. Por el orden de prelación/prioridad configurado para el concepto.
 * 2. De la más antigua a la más reciente por período/vencimiento.
 */
export function buildDetailedDueItems(
  dues: Due[],
  hierarchy: PaymentHierarchyConfig[],
  concepts: BillingConcept[]
): DetailedDueItem[] {
  const items: DetailedDueItem[] = [];

  // Mapeo de prioridades según prelación
  const priorityMap = new Map<string, number>();
  hierarchy.forEach(h => {
    if (h.concept_id) {
      priorityMap.set(h.concept_id, h.priority_order ?? 999);
    }
  });

  const conceptMap = new Map<string, BillingConcept>();
  concepts.forEach(c => conceptMap.set(c.id, c));

  dues.forEach(due => {
    // Si la deuda viene agrupada en dues, desglosamos capital e intereses si existen
    // 1. Línea de Intereses de Mora (si la deuda registra intereses)
    if (due.interest_balance && due.interest_balance > 0) {
      const interestConcept = concepts.find(c => c.is_late_interest);
      const conceptId = interestConcept?.id || 'interest-default';
      items.push({
        id: `${due.id}-interest`,
        dueId: due.id,
        period: due.period,
        dueDate: due.due_date,
        conceptId: conceptId,
        conceptCode: interestConcept?.code || 'INT',
        conceptName: interestConcept?.name || 'Intereses de Mora',
        balance: roundMoney(due.interest_balance),
        priorityOrder: priorityMap.get(conceptId) ?? 1, // Por defecto primera prioridad
        isInterest: true,
        eligibleForDiscount: false,
        discountAmount: 0,
      });
    }

    // 2. Línea de Capital / Concepto Principal (Administración, Retroactivo, etc.)
    const mainConcept = conceptMap.get(due.concept_id);
    const conceptId = due.concept_id || 'main-default';
    const mainBalance = roundMoney(due.balance - (due.interest_balance || 0));

    if (mainBalance > 0) {
      items.push({
        id: `${due.id}-capital`,
        dueId: due.id,
        period: due.period,
        dueDate: due.due_date,
        conceptId: conceptId,
        conceptCode: mainConcept?.code || 'ADM',
        conceptName: mainConcept?.name || 'Cuota de Administración',
        balance: mainBalance,
        priorityOrder: priorityMap.get(conceptId) ?? (mainConcept?.is_late_interest ? 1 : 2),
        isInterest: false,
        eligibleForDiscount: !!mainConcept?.maneja_descuento,
        discountAmount: 0, // Se calculará según la fecha contable/período
      });
    }
  });

  // Ordenamiento compuesto: 1° Prioridad del concepto, 2° Fecha de vencimiento/Período más antiguo
  return items.sort((a, b) => {
    if (a.priorityOrder !== b.priorityOrder) {
      return a.priorityOrder - b.priorityOrder;
    }
    return a.dueDate.localeCompare(b.dueDate);
  });
}

export function allocateReceipt(
  items: DetailedDueItem[],
  totalReceived: number
): AllocationResult {
  const amounts: Record<string, AllocationAmounts> = {};
  let remaining = roundMoney(Math.max(totalReceived, 0));

  for (const item of items) {
    const pay = roundMoney(Math.min(remaining, item.balance));
    amounts[item.id] = { applied: pay };
    remaining = roundMoney(remaining - pay);
  }

  const appliedTotal = roundMoney(Math.max(totalReceived, 0) - remaining);
  return {
    amounts,
    appliedTotal,
    advanceTotal: remaining,
    items,
  };
}