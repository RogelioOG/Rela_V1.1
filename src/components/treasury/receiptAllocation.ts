import type { Due, PaymentHierarchyConfig, BillingConcept } from '@/lib/supabase';

export interface DetailedDueItem {
  id: string; // Identificador único de la línea (dueId + tipo)
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
 * Desglosa las deudas leyendo el "items_snapshot" de la factura y los intereses,
 * calculando el descuento por pronto pago según la fecha de pago del recibo
 * y ordenando estrictamente por: 1° Prelación, 2° Antigüedad.
 */
export function buildDetailedDueItems(
  dues: Due[],
  hierarchy: PaymentHierarchyConfig[],
  concepts: BillingConcept[],
  invoicesMap: Record<string, any> = {},
  discountTiers: any[] = [],
  paymentDateStr: string = ''
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

  // Determinar si aplica descuento por pronto pago según la fecha de pago y discount_tiers
  let applicableDiscountPercent = 0;
  if (paymentDateStr && discountTiers.length > 0) {
    const paymentDay = new Date(paymentDateStr + 'T00:00:00').getDate();
    // Ordenar escalones por orden o valor para evaluar el más favorable primero
    const sortedTiers = [...discountTiers].sort((a, b) => (a.tier_order || 0) - (b.tier_order || 0));
    
    for (const tier of sortedTiers) {
      if (tier.is_active && paymentDay <= (tier.valid_until_day || 0)) {
        if (tier.discount_type === 'porcentaje') {
          applicableDiscountPercent = Number(tier.discount_value || 0);
          break;
        }
      }
    }
  }

  dues.forEach(due => {
    const inv = invoicesMap[due.id] || invoicesMap[due.unit_id + '_' + due.period];
    const snapshotItems = inv?.items_snapshot;

    // 1. Si hay items_snapshot en la factura, los desglosamos uno a uno (Admon, Retroactivo, etc.)
    if (Array.isArray(snapshotItems) && snapshotItems.length > 0) {
      snapshotItems.forEach((snap: any, index: number) => {
        const concept = conceptMap.get(snap.conceptId);
        const isInterest = !!concept?.is_late_interest || snap.conceptCode?.includes('MORA');
        const conceptId = snap.conceptId || `snap-${index}`;
        const amount = roundMoney(snap.amount || 0);

        if (amount > 0) {
          // Evaluar si este concepto es elegible para descuento
          let itemDiscount = 0;
          const isEligibleByTier = concept && (concept.maneja_descuento || 
            discountTiers.some(t => Array.isArray(t.calculation_base_concept_ids) && t.calculation_base_concept_ids.includes(conceptId)));

          if (isEligibleByTier && applicableDiscountPercent > 0 && !isInterest) {
            itemDiscount = roundMoney((amount * applicableDiscountPercent) / 100);
          }

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
            eligibleForDiscount: !!isEligibleByTier,
            discountAmount: itemDiscount,
          });
        }
      });
    }

    // 2. Incluir explícitamente los Intereses de Mora si la obligación registra un saldo por intereses
    const interestBalance = roundMoney(due.interest_balance || inv?.interest_amount || 0);
    if (interestBalance > 0) {
      const interestConcept = concepts.find(c => c.is_late_interest);
      const conceptId = interestConcept?.id || 'interest-default';
      
      // Evitar duplicar si ya venía en el snapshot
      const alreadyInItems = items.some(i => i.dueId === due.id && i.isInterest);
      if (!alreadyInItems) {
        items.push({
          id: `${due.id}-interest`,
          dueId: due.id,
          period: due.period,
          dueDate: due.due_date,
          conceptId: conceptId,
          conceptCode: interestConcept?.code || 'INT',
          conceptName: interestConcept?.name || 'Intereses de Mora',
          balance: interestBalance,
          priorityOrder: priorityMap.get(conceptId) ?? 1, // Los intereses suelen ir de primeros según prelación
          isInterest: true,
          eligibleForDiscount: false,
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