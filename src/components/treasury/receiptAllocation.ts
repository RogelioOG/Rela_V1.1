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
  netBalance: number;
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
  paymentDateStr: string = '',
  totalReceived: number = 0
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

  // 1. Calcular el total de la deuda pendiente sumando los balances reales de los dues e ítems de factura
  let totalPendingBalance = 0;
  dues.forEach(due => {
    const inv = invoicesMap[due.unit_id + '_' + due.period] || invoicesMap[due.id] || invoicesMap[due.invoice_id];
    const snapshotItems = inv?.items_snapshot;
    if (Array.isArray(snapshotItems) && snapshotItems.length > 0) {
      snapshotItems.forEach((snap: any) => { totalPendingBalance += Number(snap.amount || 0); });
    } else {
      totalPendingBalance += Number(due.balance || 0);
    }
    totalPendingBalance += Number(due.interest_balance || inv?.interest_amount || 0);
  });

  // 2. Selección inteligente del escalón de descuento por fecha (Soporta día límite del mes o fecha ISO)
  let matchedTier: any = null;
  if (paymentDateStr && discountTiers.length > 0) {
    const paymentDay = new Date(paymentDateStr + 'T00:00:00').getDate();
    
    matchedTier = discountTiers.find(tier => {
      const limitDate = tier.limit_date || tier.due_date_limit || tier.end_date;
      const limitDay = Number(tier.valid_until_day || tier.limit_day || tier.day_limit || 0);

      if (limitDate) {
        return paymentDateStr <= limitDate;
      }
      if (limitDay > 0) {
        return paymentDay <= limitDay;
      }
      return true; // Si está activo y no tiene restricción estricta de fecha
    });
  }

  // 3. Validar si el valor recibido cumple con el monto mínimo del escalón o cubre el neto con descuento
  let satisfiesMinimum = false;
  if (matchedTier) {
    const minRequired = Number(matchedTier.min_payment_amount || matchedTier.minimum_amount || 0);
    
    // Calcular un descuento potencial global para deducir el monto neto mínimo aceptable
    let potentialDiscountCheck = 0;
    const valNum = Number(matchedTier.discount_value || matchedTier.discount_percentage || matchedTier.percentage || matchedTier.discount_amount || 0);
    const typeCheck = matchedTier.discount_type || (valNum <= 100 ? 'porcentaje' : 'monto');
    
    if (typeCheck === 'porcentaje' || valNum <= 100) {
      potentialDiscountCheck = (totalPendingBalance * valNum) / 100;
    } else {
      potentialDiscountCheck = valNum;
    }

    const netTarget = Math.max(totalPendingBalance - potentialDiscountCheck, 0);

    if (minRequired > 0) {
      satisfiesMinimum = totalReceived >= minRequired;
    } else {
      // Se activa si el pago cubre el neto con descuento o si paga el total completo
      satisfiesMinimum = totalReceived >= netTarget || (totalReceived >= totalPendingBalance && totalPendingBalance > 0);
    }
  }

  dues.forEach(due => {
    const inv = invoicesMap[due.unit_id + '_' + due.period] || invoicesMap[due.id] || invoicesMap[due.invoice_id];
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
            discountTiers.some(t => Array.isArray(t.calculation_base_concept_ids) && t.calculation_base_concept_ids.includes(conceptId)) || true); // Flexible por defecto si aplica a la factura

          if (matchedTier && satisfiesMinimum && isEligibleByConcept && !isInterest) {
            const baseConceptIds = matchedTier.calculation_base_concept_ids;
            const appliesToThisConcept = !baseConceptIds || baseConceptIds.length === 0 || baseConceptIds.includes(conceptId);

            if (appliesToThisConcept) {
              const valNum = Number(matchedTier.discount_value || matchedTier.discount_percentage || matchedTier.percentage || matchedTier.discount_amount || 0);
              const type = matchedTier.discount_type || (valNum <= 100 ? 'porcentaje' : 'monto');

              if (type === 'porcentaje' || valNum <= 100) {
                itemDiscount = roundMoney((amount * valNum) / 100);
              } else {
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
    } else {
      // Si no hay snapshot, usamos el due directamente
      const amount = roundMoney(due.balance || 0);
      if (amount > 0) {
        let itemDiscount = 0;
        const concept = conceptMap.get(due.concept_id);
        const isInterest = !!concept?.is_late_interest;

        if (matchedTier && satisfiesMinimum && !isInterest) {
          const valNum = Number(matchedTier.discount_value || matchedTier.discount_percentage || matchedTier.percentage || matchedTier.discount_amount || 0);
          const type = matchedTier.discount_type || (valNum <= 100 ? 'porcentaje' : 'monto');
          if (type === 'porcentaje' || valNum <= 100) {
            itemDiscount = roundMoney((amount * valNum) / 100);
          } else {
            itemDiscount = roundMoney(Math.min(valNum, amount));
          }
        }

        const netBal = roundMoney(Math.max(amount - itemDiscount, 0));

        items.push({
          id: due.id,
          dueId: due.id,
          period: due.period,
          dueDate: due.due_date,
          conceptId: due.concept_id,
          conceptCode: concept?.code || 'CON',
          conceptName: concept?.name || 'Cuota de Administración',
          balance: amount,
          netBalance: netBal,
          priorityOrder: priorityMap.get(due.concept_id) ?? 2,
          isInterest: isInterest,
          eligibleForDiscount: true,
          discountAmount: itemDiscount,
        });
      }
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