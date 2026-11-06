import type { Due, PaymentHierarchyConfig, BillingConcept } from '@/lib/supabase';

export interface DetailedDueItem {
  id: string; // Identificador único de la línea
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
 * Desglosa las deudas leyendo el "items_snapshot" de la factura asociada,
 * garantizando que se muestren todos los conceptos reales (Administración, Retroactivo, Intereses, etc.)
 * ordenados por: 1° Prelación del concepto, 2° Antigüedad del período.
 */
export function buildDetailedDueItems(
  dues: Due[],
  hierarchy: PaymentHierarchyConfig[],
  concepts: BillingConcept[],
  invoicesMap: Record<string, any> = {}
): DetailedDueItem[] {
  const items: DetailedDueItem[] = [];

  // Mapeo de prioridades según prelación configurada
  const priorityMap = new Map<string, number>();
  hierarchy.forEach(h => {
    if (h.concept_id) {
      priorityMap.set(h.concept_id, h.priority_order ?? 999);
    }
  });

  const conceptMap = new Map<string, BillingConcept>();
  concepts.forEach(c => conceptMap.set(c.id, c));

  dues.forEach(due => {
    // Buscamos si la deuda tiene un invoice asociado y un items_snapshot válido
    const inv = invoicesMap[due.id] || invoicesMap[due.unit_id + '_' + due.period];
    const snapshotItems = inv?.items_snapshot;

    if (Array.isArray(snapshotItems) && snapshotItems.length > 0) {
      // Si tenemos el snapshot de la factura, desglosamos cada ítem exactamente como se facturó
      snapshotItems.forEach((snap: any, index: number) => {
        const concept = conceptMap.get(snap.conceptId);
        const isInterest = !!concept?.is_late_interest || snap.conceptCode?.includes('MORA');
        const conceptId = snap.conceptId || `snap-${index}`;
        const amount = roundMoney(snap.amount || 0);

        if (amount > 0) {
          items.push({
            id: `${due.id}-snap-${index}`,
            dueId: due.id,
            period: due.period,
            dueDate: due.due_date,
            conceptId: conceptId,
            conceptCode: concept?.code || snap.conceptCode || 'CON',
            conceptName: concept?.name || snap.conceptName || 'Concepto de Cobro',
            balance: amount,
            priorityOrder: priorityMap.get(conceptId) ?? (isInterest ? 1 : 2),
            isInterest: isInterest,
            eligibleForDiscount: !!concept?.maneja_descuento,
            discountAmount: 0,
          });
        }
      });
    } else {
      // Fallback por seguridad si el snapshot no viniera cargado: desglose estándar de la deuda
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
          priorityOrder: priorityMap.get(conceptId) ?? 1,
          isInterest: true,
          eligibleForDiscount: false,
          discountAmount: 0,
        });
      }

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
          priorityOrder: priorityMap.get(conceptId) ?? 2,
          isInterest: false,
          eligibleForDiscount: !!mainConcept?.maneja_descuento,
          discountAmount: 0,
        });
      }
    }
  });

  // Ordenamiento compuesto estricto: 1° Prioridad del concepto (Prelación), 2° Antigüedad del período
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