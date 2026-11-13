import type { Due, PaymentHierarchyConfig, BillingConcept } from '@/lib/supabase';

export interface DetailedDueItem {
  id: string;
  dueId: string;
  period: string;
  dueDate: string;
  conceptId: string;
  conceptCode: string;
  conceptName: string;
  balance: number;
  netBalance: number; // Saldo real restando el descuento pronto pago si aplica
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

export function buildDetailedDueItems(
  dues: Due[],
  hierarchy: PaymentHierarchyConfig[],
  concepts: BillingConcept[],
  invoicesMap: Record<string, any> = {},
  discountTiers: any[] = [],
  paymentDateStr: string = ''
): DetailedDueItem[] {
  const items: DetailedDueItem[] = [];

  const priorityMap = new Map<string, number>();
  hierarchy.forEach(h => {
    if (h.concept_id) {
      priorityMap.set(h.concept_id, h.priority_order ?? 999);
    }
  });

  const conceptMap = new Map<string, BillingConcept>();
  concepts.forEach(c => conceptMap.set(c.id, c));

  // Selección inteligente del escalón de descuento aplicable según la fecha de pago
  let matchedTier: any = null;
  if (paymentDateStr && discountTiers.length > 0) {
    const paymentDay = new Date(paymentDateStr + 'T00:00:00').getDate();
    // Ordenar los escalones por orden o por día válido de menor a mayor
    const sortedTiers = [...discountTiers].sort((a, b) => (a.valid_until_day || 0) - (b.valid_until_day || 0));
    
    for (const tier of sortedTiers) {
      if (tier.is_active && paymentDay <= (tier.valid_until_day || 0)) {
        matchedTier = tier;
        break; // Tomamos el primer escalón válido al que alcance a llegar por fecha
      }
    }
  }

  dues.forEach(due => {
    const inv = invoicesMap[due.id] || invoicesMap[due.unit_id + '_' + due.period];
    const snapshotItems = inv?.items_snapshot;

    if (Array.isArray(snapshotItems) && snapshotItems.length > 0) {
      snapshotItems.forEach((snap: any, index: number) => {
        const concept = conceptMap.get(snap.conceptId);
        const isInterest = !!concept?.is_late_interest || snap.conceptCode?.includes('MORA');
        const conceptId = snap.conceptId || `snap-${index}`;
        const amount = roundMoney(snap.amount || 0);

        if (amount > 0) {
          let itemDiscount = 0;
          
          const isEligibleByConcept = concept && (concept.maneja_descuento || 
            discountTiers.some(t => Array.isArray(t.calculation_base_concept_ids) && t.calculation_base_concept_ids.includes(conceptId)));

          if (matchedTier && isEligibleByConcept && !isInterest) {
            const baseConceptIds = matchedTier.calculation_base_concept_ids;
            const appliesToThisConcept = !baseConceptIds || baseConceptIds.length === 0 || baseConceptIds.includes(conceptId);

            if (appliesToThisConcept) {
              const valNum = Number(matchedTier.discount_value || 0);
              if (matchedTier.discount_type === 'porcentaje') {
                itemDiscount = roundMoney((amount * valNum) / 100);
              } else if (matchedTier.discount_type === 'monto') {
                // Si es monto fijo, se distribuye proporcionalmente o se aplica hasta el monto del ítem
                itemDiscount = roundMoney(Math.min(valNum, amount));
              }
            }
          }

          const netBal = roundMoney(Math.max(amount - itemDiscount, 0));

          items.push({
            id: `${due.id}-snap-${index}`,
            dueId: due.id,
            period: due.period,
            dueDate: due.due_date,
            conceptId: conceptId,
            conceptCode: concept?.code || snap.conceptCode || 'CON',
            conceptName: concept?.name || snap.conceptName || 'Concepto de Cobro',
            balance: amount,
            netBalance: netBal,
            priorityOrder: priorityMap.get(conceptId) ?? (isInterest ? 1 : 2),
            isInterest: isInterest,
            eligibleForDiscount: !!isEligibleByConcept,
            discountAmount: itemDiscount,
          });
        }
      });
    }

    const interestBalance = roundMoney(due.interest_balance || inv?.interest_amount || 0);
    if (interestBalance > 0) {
      const interestConcept = concepts.find(c => c.is_late_interest);
      const conceptId = interestConcept?.id || 'interest-default';
      
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
          netBalance: interestBalance,
          priorityOrder: priorityMap.get(conceptId) ?? 1,
          isInterest: true,
          eligibleForDiscount: false,
          discountAmount: 0,
        });
      }
    }
  });

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
    const targetBalance = item.netBalance > 0 ? item.netBalance : item.balance;
    const pay = roundMoney(Math.min(remaining, targetBalance));
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