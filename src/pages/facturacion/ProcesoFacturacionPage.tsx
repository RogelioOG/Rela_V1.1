import { useEffect, useState, useMemo, useCallback } from 'react';
import { Calculator, Loader2, AlertTriangle, CheckCircle2, Info, Clock, Percent, RefreshCw, ChevronRight, Calendar, Layers } from 'lucide-react';
import { supabase, Unit, Due, PaymentAgreement, AdminQuota, AdminQuotaLine, PeriodNovelty, DiscountTier, BillingConcept } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP } from '@/lib/format';
import Paso2FormatoEnvio from '@/components/facturacion/Paso2FormatoEnvio';

export interface ChargeLine {
  conceptId: string;
  conceptName: string;
  conceptCode: string;
  amount: number;
  isQuota: boolean;
  isNovelty: boolean;
}

export interface LiquidationRow {
  due: Due | null;
  unit: Unit;
  daysLate: number;
  interestRate: number;
  priorBalance: number;
  currentCharges: number;
  chargeLines: ChargeLine[];
  interestAmount: number;
  discountAmount: number;
  netTotal: number;
  rowId: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type CutoffRule = 'inicio_mes_facturar' | 'cierre_mes_anterior';

const cutoffRuleLabels: Record<CutoffRule, string> = {
  inicio_mes_facturar: 'Día 1 del mes a facturar',
  cierre_mes_anterior: 'Día de cierre del mes anterior',
};

const cutoffRuleHelp: Record<CutoffRule, string> = {
  inicio_mes_facturar: 'El corte se toma al primer día del periodo a facturar. Solo generan interés los saldos vencidos con fecha de vencimiento anterior al primer día del mes que se está facturando.',
  cierre_mes_anterior: 'El corte se toma al último día del mes inmediatamente anterior al periodo. Solo generan interés los saldos vencidos con fecha de vencimiento anterior o igual al cierre del mes previo.',
};

function getDaysLate(dueDate: string, graceDays: number, cutoffDate: Date): number {
  const due = new Date(dueDate);
  const ms = cutoffDate.getTime() - due.getTime();
  if (ms <= 0) return 0;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  return Math.max(0, days - graceDays);
}

function getCutoffDate(period: string, rule: CutoffRule): Date {
  const [y, m] = period.split('-').map(Number);
  if (rule === 'inicio_mes_facturar') {
    return new Date(y, m - 1, 1);
  }
  return new Date(y, m - 2 + 1, 0);
}

function isEligibleDue(dueDate: string, cutoffDate: Date): boolean {
  const due = new Date(dueDate);
  return due.getTime() < cutoffDate.getTime();
}

const STEPS = [
  { num: 1, label: 'Configuración de Intereses' },
  { num: 2, label: 'Descuentos por Propiedad' },
  { num: 3, label: 'Formatos y Envío' },
  { num: 4, label: 'Finalización' },
];

interface DiscountRow {
  unitId: string;
  unitLabel: string;
  tower: string;
  baseAmount: number;
  discountAmount: number;
  netAmount: number;
  manualOverride: boolean;
  overrideDiscount: string;
  chargeLines: ChargeLine[];
}

export default function ProcesoFacturacionPage() {
  const { activeOrg } = useOrg();
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);

  const [interestRate, setInterestRate] = useState('0.50');
  const [graceDays, setGraceDays] = useState('5');
  const [billingPeriod, setBillingPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [cutoffRule, setCutoffRule] = useState<CutoffRule>('cierre_mes_anterior');
  const [customStartDate, setCustomStartDate] = useState('');

  const [dues, setDues] = useState<Due[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [agreements, setAgreements] = useState<PaymentAgreement[]>([]);
  const [defaultedAgreements, setDefaultedAgreements] = useState<PaymentAgreement[]>([]);
  const [adminQuotas, setAdminQuotas] = useState<AdminQuota[]>([]);
  const [novelties, setNovelties] = useState<PeriodNovelty[]>([]);
  const [discountTiers, setDiscountTiers] = useState<DiscountTier[]>([]);
  const [concepts, setConcepts] = useState<BillingConcept[]>([]);

  const [reviewing, setReviewing] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [liquidation, setLiquidation] = useState<LiquidationRow[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');

  const [discountRows, setDiscountRows] = useState<DiscountRow[]>([]);

  const loadData = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [
      { data: duesData },
      { data: unitsData },
      { data: agrData },
      { data: quotaData },
      { data: noveltyData },
      { data: tierData },
      { data: conceptData },
    ] = await Promise.all([
      supabase
        .from('dues')
        .select('*, units(*)')
        .eq('organization_id', activeOrg.id)
        .neq('status', 'pagada')
        .order('due_date', { ascending: false }),
      supabase
        .from('units')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('unit_label'),
      supabase
        .from('payment_agreements')
        .select('*, units(*)')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .eq('status', 'incumplido'),
      supabase
        .from('admin_quotas')
        .select('*, admin_quota_lines(*), billing_concept:billing_concepts(*)')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true),
      supabase
        .from('period_novelties')
        .select('*, billing_concept:billing_concepts(*), units:units(*)')
        .eq('organization_id', activeOrg.id)
        .eq('is_invoiced', false),
      supabase
        .from('discount_tiers')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('tier_order', { ascending: true }),
      supabase
        .from('billing_concepts')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name'),
    ]);
    setDues((duesData || []) as Due[]);
    setUnits((unitsData || []) as Unit[]);
    setAgreements((agrData || []) as PaymentAgreement[]);
    setAdminQuotas((quotaData || []) as AdminQuota[]);
    setNovelties((noveltyData || []) as PeriodNovelty[]);
    setDiscountTiers((tierData || []) as DiscountTier[]);
    setConcepts((conceptData || []) as BillingConcept[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { if (activeOrg) loadData(); }, [activeOrg, loadData]);

  // Hidratación automática: Verifica si ya existe facturación para este periodo y auto-restaura el estado
  useEffect(() => {
    async function checkExistingPeriodHydration() {
      if (!activeOrg || !billingPeriod || units.length === 0) return;
      try {
        const { data: existingDues } = await supabase
          .from('dues')
          .select('*, units(*)')
          .eq('organization_id', activeOrg.id)
          .eq('period', billingPeriod);

        if (existingDues && existingDues.length > 0) {
          // Reconstruir la liquidación a partir de los registros ya guardados en cartera
          const restoredRows: LiquidationRow[] = existingDues.map(d => ({
            due: d,
            unit: d.units || units.find(u => u.id === d.unit_id) || units[0],
            daysLate: 0,
            interestRate: parseFloat(interestRate) || 0.5,
            priorBalance: 0,
            currentCharges: d.amount,
            chargeLines: [],
            interestAmount: 0,
            discountAmount: 0,
            netTotal: d.balance,
            rowId: d.id,
          }));

          setLiquidation(restoredRows);
          setReviewed(true);
          setCurrentStep(3); // Salta directamente al paso de Formatos y Envío si ya está facturado
        }
      } catch (e) {
        console.warn('Error al hidratar el estado del periodo:', e);
      }
    }
    checkExistingPeriodHydration();
  }, [activeOrg, billingPeriod, units]);

  const effectiveCutoffDate = useMemo(() => {
    if (customStartDate) return new Date(customStartDate + 'T00:00:00');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingPeriod)) return new Date();
    return getCutoffDate(billingPeriod, cutoffRule);
  }, [customStartDate, billingPeriod, cutoffRule]);

  const activeTiers = useMemo(() => [...discountTiers].sort((a, b) => a.valid_until_day - b.valid_until_day), [discountTiers]);
  const hasDiscounts = activeTiers.length > 0;

  const conceptMap = useMemo(() => {
    const m = new Map<string, BillingConcept>();
    for (const c of concepts) m.set(c.id, c);
    return m;
  }, [concepts]);

  const unitChargeLinesMap = useMemo(() => {
    const map = new Map<string, ChargeLine[]>();
    const conceptById = (id: string) => conceptMap.get(id);

    for (const quota of adminQuotas) {
      const lines = quota.admin_quota_lines || [];
      const concept = quota.billing_concept_id ? conceptById(quota.billing_concept_id) : null;
      if (lines.length > 0) {
        for (const line of lines) {
          const existing = map.get(line.unit_id) || [];
          existing.push({
            conceptId: quota.billing_concept_id,
            conceptName: concept?.name || 'Cuota de Administración',
            conceptCode: concept?.code || 'ADM',
            amount: line.amount,
            isQuota: true,
            isNovelty: false,
          });
          map.set(line.unit_id, existing);
        }
      } else if (quota.calculation_method === 'fijo') {
        for (const u of units) {
          const existing = map.get(u.id) || [];
          existing.push({
            conceptId: quota.billing_concept_id,
            conceptName: concept?.name || 'Cuota de Administración',
            conceptCode: concept?.code || 'ADM',
            amount: quota.fixed_amount,
            isQuota: true,
            isNovelty: false,
          });
          map.set(u.id, existing);
        }
      } else if (quota.calculation_method === 'presupuesto') {
        const totalCoeff = units.reduce((s, u) => s + u.coefficient, 0) || 1;
        for (const u of units) {
          const amt = round2(quota.budget_amount * u.coefficient / totalCoeff);
          const existing = map.get(u.id) || [];
          existing.push({
            conceptId: quota.billing_concept_id,
            conceptName: concept?.name || 'Cuota de Administración',
            conceptCode: concept?.code || 'ADM',
            amount: amt,
            isQuota: true,
            isNovelty: false,
          });
          map.set(u.id, existing);
        }
      }
    }

    for (const n of novelties) {
      if (n.unit_id) {
        const concept = n.billing_concept_id ? conceptById(n.billing_concept_id) : null;
        const existing = map.get(n.unit_id) || [];
        existing.push({
          conceptId: n.billing_concept_id,
          conceptName: concept?.name || n.description || 'Novedad',
          conceptCode: concept?.code || 'NOV',
          amount: n.value,
          isQuota: false,
          isNovelty: true,
        });
        map.set(n.unit_id, existing);
      }
    }

    return map;
  }, [adminQuotas, novelties, units, conceptMap]);

  const unitPriorBalanceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const due of dues) {
      if (!isEligibleDue(due.due_date, effectiveCutoffDate)) continue;
      const existing = map.get(due.unit_id) || 0;
      map.set(due.unit_id, existing + due.balance);
    }
    return map;
  }, [dues, effectiveCutoffDate]);

  const unitInterestMap = useMemo(() => {
    const rate = parseFloat(interestRate) || 0;
    const grace = parseInt(graceDays) || 0;
    const map = new Map<string, number>();
    for (const due of dues) {
      if (!isEligibleDue(due.due_date, effectiveCutoffDate)) continue;
      const days = getDaysLate(due.due_date, grace, effectiveCutoffDate);
      const interest = round2(due.balance * (rate / 100) * days);
      const existing = map.get(due.unit_id) || 0;
      map.set(due.unit_id, existing + interest);
    }
    return map;
  }, [dues, interestRate, graceDays, effectiveCutoffDate]);

  const computedLiquidation: LiquidationRow[] = useMemo(() => {
    const rate = parseFloat(interestRate) || 0;
    return units.map(unit => {
      const chargeLines = unitChargeLinesMap.get(unit.id) || [];
      const currentCharges = round2(chargeLines.reduce((s, l) => s + l.amount, 0));
      const priorBalance = unitPriorBalanceMap.get(unit.id) || 0;
      const interestAmount = unitInterestMap.get(unit.id) || 0;
      return {
        due: null,
        unit,
        daysLate: 0,
        interestRate: rate,
        priorBalance,
        currentCharges,
        chargeLines,
        interestAmount,
        discountAmount: 0,
        netTotal: round2(priorBalance + currentCharges + interestAmount),
        rowId: unit.id,
      };
    }).filter(r => r.currentCharges > 0 || r.priorBalance > 0 || r.interestAmount > 0);
  }, [units, unitChargeLinesMap, unitPriorBalanceMap, unitInterestMap, interestRate]);

  const totalPriorBalance = useMemo(() => (reviewed ? liquidation : computedLiquidation).reduce((s, r) => s + r.priorBalance, 0), [reviewed, liquidation, computedLiquidation]);
  const totalCurrentCharges = useMemo(() => (reviewed ? liquidation : computedLiquidation).reduce((s, r) => s + r.currentCharges, 0), [reviewed, liquidation, computedLiquidation]);
  const totalInterest = useMemo(() => (reviewed ? liquidation : computedLiquidation).reduce((s, r) => s + r.interestAmount, 0), [reviewed, liquidation, computedLiquidation]);
  const totalGeneral = useMemo(() => (reviewed ? liquidation : computedLiquidation).reduce((s, r) => s + r.netTotal, 0), [reviewed, liquidation, computedLiquidation]);

  function handleInterestRateChange(value: string) {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) { setInterestRate(''); return; }
    const rounded = Math.round(parsed * 100) / 100;
    setInterestRate(String(rounded));
  }

  function computeAutoDiscount(currentCharges: number, chargeLines: ChargeLine[]): number {
    const activeTier = activeTiers[0]; 
    if (!activeTier) return 0;

    if (activeTier.discount_type === 'porcentaje') {
      const baseConceptIds = activeTier.calculation_base_concept_ids;
      const base = baseConceptIds && baseConceptIds.length > 0
        ? round2(chargeLines
            .filter(l => baseConceptIds.includes(l.conceptId))
            .reduce((s, l) => s + l.amount, 0))
        : currentCharges;
      return round2(base * activeTier.discount_value / 100);
    } else {
      return Math.min(activeTier.discount_value, currentCharges);
    }
  }

  async function handleReviewLiquidation() {
    if (!activeOrg) return;
    setReviewing(true);
    setError('');
    try {
      const { data: defaulted, error: agrErr } = await supabase
        .from('payment_agreements')
        .select('*, units(*)')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .eq('status', 'incumplido');
      if (agrErr) throw new Error(agrErr.message);
      const defaultedAgrs = (defaulted || []) as PaymentAgreement[];
      setDefaultedAgreements(defaultedAgrs);

      const rows = computedLiquidation;
      setLiquidation(rows);

      if (hasDiscounts) {
        const dRows: DiscountRow[] = rows.map(r => {
          const appliedDiscount = computeAutoDiscount(r.currentCharges, r.chargeLines);
          return {
            unitId: r.unit.id,
            unitLabel: r.unit.unit_label,
            tower: r.unit.tower,
            baseAmount: r.currentCharges,
            discountAmount: appliedDiscount,
            netAmount: round2(r.currentCharges - appliedDiscount),
            manualOverride: false,
            overrideDiscount: '',
            chargeLines: r.chargeLines,
          };
        });
        setDiscountRows(dRows);
      }

      setReviewed(true);
      if (defaultedAgrs.length > 0) setWarningOpen(true);
      setReviewing(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al revisar la liquidación';
      setError(msg);
      setReviewing(false);
    }
  }

  function handleRowInterestAmountChange(unitId: string, newInterest: number) {
    setLiquidation(prev =>
      prev.map(row => {
        if (row.unit.id !== unitId) return row;
        return {
          ...row,
          interestAmount: round2(newInterest),
          netTotal: round2(row.priorBalance + row.currentCharges + newInterest - row.discountAmount),
        };
      })
    );
  }

  function applyManualDiscount(idx: number, discountStr: string) {
    setDiscountRows(prev => {
      const updated = [...prev];
      const row = updated[idx];
      if (discountStr === '') {
        const autoDiscount = computeAutoDiscount(row.baseAmount, row.chargeLines);
        updated[idx] = {
          ...row,
          discountAmount: autoDiscount,
          netAmount: round2(row.baseAmount - autoDiscount),
          manualOverride: false,
          overrideDiscount: '',
        };
      } else {
        const overrideVal = parseFloat(discountStr) || 0;
        const newDiscount = Math.min(overrideVal, row.baseAmount);
        updated[idx] = {
          ...row,
          discountAmount: newDiscount,
          netAmount: round2(row.baseAmount - newDiscount),
          manualOverride: true,
          overrideDiscount: discountStr,
        };
      }
      return updated;
    });
  }

  function applyDiscountsAndAdvance() {
    setLiquidation(prev => prev.map(row => {
      const dRow = discountRows.find(d => d.unitId === row.unit.id);
      if (!dRow) return row;
      return {
        ...row,
        discountAmount: dRow.discountAmount,
        netTotal: round2(row.priorBalance + row.currentCharges + row.interestAmount - dRow.discountAmount),
      };
    }));
    setCurrentStep(3);
  }

  const totalDiscountBase = useMemo(() => discountRows.reduce((s, r) => s + r.baseAmount, 0), [discountRows]);
  const totalDiscountAmount = useMemo(() => discountRows.reduce((s, r) => s + r.discountAmount, 0), [discountRows]);
  const totalDiscountNet = useMemo(() => discountRows.reduce((s, r) => s + r.netAmount, 0), [discountRows]);

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Proceso de Facturación</h1>
        <p className="text-gray-500 mt-1">Generación de facturación con cuotas, novedades, intereses de mora y descuentos</p>
      </div>

      {/* Stepper */}
      <div className="mb-6">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {STEPS.map((step, idx) => (
            <div key={step.num} className="flex items-center gap-2 flex-shrink-0">
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentStep === step.num
                    ? 'bg-blue-600 text-white'
                    : currentStep > step.num
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                <div
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-xs ${
                    currentStep === step.num
                      ? 'bg-white text-blue-600'
                      : currentStep > step.num
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-300 text-gray-600'
                  }`}
                >
                  {currentStep > step.num ? <CheckCircle2 className="w-4 h-4" /> : step.num}
                </div>
                {step.label}
              </div>
              {idx < STEPS.length - 1 && <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
        </div>
      ) : (
        <>
          {/* Step 1 */}
          {currentStep === 1 && (
            <>
          <Card className="mb-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Percent className="w-5 h-5 text-blue-600" />
                Paso 1: Configuración de Intereses
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Defina los parámetros para el cálculo de intereses de mora. El sistema carga automáticamente las cuotas de administración, novedades del periodo y saldos vencidos.
              </p>
            </div>
            <CardBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <Input
                    label="Tasa de Interés de Mora (%)"
                    type="number"
                    step="0.01"
                    min="0"
                    max="99.99"
                    value={interestRate}
                    onChange={(e) => handleInterestRateChange(e.target.value)}
                    placeholder="Ej: 0.50"
                  />
                  <p className="text-xs text-gray-400 mt-1">Parámetro de cálculo. No editable por propiedad.</p>
                </div>
                <div>
                  <Input
                    label="Días de Gracia"
                    type="number"
                    min="0"
                    value={graceDays}
                    onChange={(e) => setGraceDays(e.target.value)}
                    placeholder="Ej: 5"
                  />
                  <p className="text-xs text-gray-400 mt-1">Días posteriores al vencimiento sin interés.</p>
                </div>
                <div>
                  <Input
                    label="Periodo de Facturación (YYYY-MM)"
                    type="text"
                    value={billingPeriod}
                    onChange={(e) => setBillingPeriod(e.target.value)}
                    placeholder="Ej: 2026-10"
                  />
                  <p className="text-xs text-gray-400 mt-1">Mes que se está facturando.</p>
                </div>
                <div>
                  <Select
                    label="Fecha de Corte / Inicio de Cobro"
                    value={cutoffRule}
                    onChange={(e) => { setCutoffRule(e.target.value as CutoffRule); setCustomStartDate(''); }}
                  >
                    <option value="cierre_mes_anterior">Día de cierre del mes anterior</option>
                    <option value="inicio_mes_facturar">Día 1 del mes a facturar</option>
                  </Select>
                  <p className="text-xs text-gray-400 mt-1">Define el corte de saldos elegibles.</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Input
                    label="Fecha de Inicio de Cobro Personalizada (opcional)"
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    placeholder="DD/MM/AAAA"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Si se especifica, anula la regla de corte. Solo se liquidan saldos vencidos a esta fecha.
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-blue-600 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-gray-500">Fecha de corte efectiva</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {effectiveCutoffDate.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {customStartDate ? 'Fecha personalizada' : cutoffRuleLabels[cutoffRule]}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-center">
                  <p className="text-xs text-gray-500">Cuotas activas</p>
                  <p className="text-lg font-bold text-gray-900">{adminQuotas.length}</p>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-center">
                  <p className="text-xs text-gray-500">Novedades pendientes</p>
                  <p className="text-lg font-bold text-gray-900">{novelties.length}</p>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-center">
                  <p className="text-xs text-gray-500">Saldos vencidos</p>
                  <p className="text-lg font-bold text-gray-900">{dues.length}</p>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-center">
                  <p className="text-xs text-gray-500">Escalones de descuento</p>
                  <p className="text-lg font-bold text-gray-900">{activeTiers.length}</p>
                </div>
              </div>

              <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  {customStartDate
                    ? 'Se utilizará la fecha personalizada como corte. Solo generan interés los saldos con vencimiento anterior a esa fecha.'
                    : cutoffRuleHelp[cutoffRule]}
                  {' El sistema suma automáticamente las cuotas de administración guardadas, las novedades del periodo no facturadas, y los intereses de mora calculados sobre saldos vencidos.'}
                </p>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Button onClick={handleReviewLiquidation} disabled={reviewing}>
                  {reviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                  Revisar Liquidación
                </Button>
                {reviewed && defaultedAgreements.length === 0 && (
                  <span className="text-sm text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> Revisión completada sin incumplimientos
                  </span>
                )}
                {reviewed && defaultedAgreements.length > 0 && (
                  <span className="text-sm text-red-600 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> {defaultedAgreements.length} acuerdo(s) incumplido(s) detectado(s)
                  </span>
                )}
              </div>

              {reviewed && (
                <div className="mt-4 flex justify-end">
                  <Button onClick={() => setCurrentStep(hasDiscounts ? 2 : 3)}>
                    {hasDiscounts ? 'Continuar a Descuentos' : 'Continuar a Formatos'} <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          {reviewed && (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
              <Card><CardBody>
                <p className="text-sm text-gray-500">Saldos Anteriores</p>
                <p className="text-xl font-bold text-gray-900">{formatCOP(totalPriorBalance)}</p>
              </CardBody></Card>
              <Card><CardBody>
                <p className="text-sm text-gray-500">Cargos del Periodo</p>
                <p className="text-xl font-bold text-gray-900">{formatCOP(totalCurrentCharges)}</p>
              </CardBody></Card>
              <Card><CardBody>
                <p className="text-sm text-gray-500">Intereses de Mora</p>
                <p className="text-xl font-bold text-yellow-600">{formatCOP(totalInterest)}</p>
              </CardBody></Card>
              <Card><CardBody>
                <p className="text-sm text-gray-500">Total a Facturar</p>
                <p className="text-xl font-bold text-blue-700">{formatCOP(totalGeneral)}</p>
              </CardBody></Card>
            </div>
          )}

          {reviewed && (
            <Card>
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Calculator className="w-5 h-5 text-blue-600" />
                  Tabla de Liquidación
                </h2>
                <Button variant="outline" size="sm" onClick={handleReviewLiquidation}>
                  <RefreshCw className="w-4 h-4" /> Recalcular
                </Button>
              </div>
              {(reviewed ? liquidation : computedLiquidation).length === 0 ? (
                <div className="text-center py-12">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-100 mb-3">
                    <Clock className="w-7 h-7 text-gray-400" />
                  </div>
                  <p className="text-gray-500">No hay cuotas, novedades ni saldos pendientes para facturar en este periodo</p>
                  <p className="text-sm text-gray-400 mt-1">Puede continuar al siguiente paso sin saldos pendientes.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Propiedad</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden sm:table-cell">Saldo Anterior</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Cargos del Periodo</th>
                        <th className="text-center text-xs font-semibold text-gray-600 uppercase px-6 py-3">Tasa (%)</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Interés Mora</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {liquidation.map((row) => (
                        <tr key={row.rowId} className="hover:bg-gray-50">
                          <td className="px-6 py-3">
                            <p className="text-sm font-medium text-gray-900">{row.unit.tower} {row.unit.unit_label}</p>
                            <p className="text-xs text-gray-500">{row.unit.owner_name || ''}</p>
                          </td>
                          <td className="px-6 py-3 text-right text-sm text-gray-700 hidden sm:table-cell">
                            {row.priorBalance > 0 ? formatCOP(row.priorBalance) : '—'}
                          </td>
                          <td className="px-6 py-3 text-right text-sm text-gray-900">{formatCOP(row.currentCharges)}</td>
                          <td className="px-6 py-3 text-center text-sm text-gray-500">
                            {row.interestRate.toFixed(2)}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={row.interestAmount}
                              onChange={(e) => {
                                const val = Math.round((parseFloat(e.target.value) || 0) * 100) / 100;
                                handleRowInterestAmountChange(row.unit.id, val);
                              }}
                              className="w-24 text-right text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </td>
                          <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">{formatCOP(row.netTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td className="px-6 py-3 text-sm font-semibold text-gray-900">Totales:</td>
                        <td className="px-6 py-3 text-right text-sm font-bold text-gray-900 hidden sm:table-cell">{formatCOP(totalPriorBalance)}</td>
                        <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">{formatCOP(totalCurrentCharges)}</td>
                        <td className="px-6 py-3" />
                        <td className="px-6 py-3 text-right text-sm font-bold text-yellow-600">{formatCOP(totalInterest)}</td>
                        <td className="px-6 py-3 text-right text-sm font-bold text-blue-700">{formatCOP(totalGeneral)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          )}
          </>
          )}

          {/* Step 2: Discount Configuration */}
          {currentStep === 2 && hasDiscounts && (
            <Card>
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-blue-600" />
                  Paso 2: Descuentos por Propiedad
                </h2>
                <div className="flex items-center gap-2">
                  {activeTiers.map(t => (
                    <Badge key={t.id} variant="blue">
                      {t.discount_type === 'porcentaje' ? `${t.discount_value}%` : formatCOP(t.discount_value)} — {t.name} (día {t.valid_until_day})
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="p-5">
                <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
                  <p className="text-sm text-blue-800">
                    Los descuentos se calcularon automáticamente según los escalones configurados, el día actual y la base de cálculo de cada escalón (conceptos seleccionados o Valor Total).
                    Puede ajustar manualmente el descuento por propiedad. Borre el campo para revertir al cálculo automático.
                  </p>
                </div>
                {discountRows.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500">No hay propiedades con cargos para aplicar descuentos.</p>
                  </div>
                ) : (
                  <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Propiedad</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Base Aplicada</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Descuento</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Neto con Descuento</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {discountRows.map((row, idx) => {
                          const activeTier = activeTiers.find(t => new Date().getDate() <= t.valid_until_day);
                          const appliedBase = activeTier && activeTier.discount_type === 'porcentaje'
                            ? (activeTier.calculation_base_concept_ids && activeTier.calculation_base_concept_ids.length > 0
                              ? round2(row.chargeLines.filter(l => activeTier.calculation_base_concept_ids!.includes(l.conceptId)).reduce((s, l) => s + l.amount, 0))
                              : row.baseAmount)
                            : row.baseAmount;
                          return (
                          <tr key={row.unitId} className={`hover:bg-gray-50 ${row.manualOverride ? 'bg-amber-50' : ''}`}>
                            <td className="px-4 py-3">
                              <p className="font-medium text-gray-900">{row.tower} {row.unitLabel}</p>
                              {row.manualOverride && <Badge variant="yellow">Manual</Badge>}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-700">
                              {formatCOP(appliedBase)}
                              {activeTier && activeTier.discount_type === 'porcentaje' && activeTier.calculation_base_concept_ids && activeTier.calculation_base_concept_ids.length > 0 && (
                                <p className="text-xs text-gray-400">{activeTier.calculation_base_concept_ids.length} concepto(s)</p>
                              )}
                              {activeTier && activeTier.discount_type === 'porcentaje' && (!activeTier.calculation_base_concept_ids || activeTier.calculation_base_concept_ids.length === 0) && (
                                <p className="text-xs text-gray-400">Valor Total</p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={row.manualOverride ? row.overrideDiscount : row.discountAmount > 0 ? String(row.discountAmount) : ''}
                                  onChange={(e) => applyManualDiscount(idx, e.target.value)}
                                  placeholder="0"
                                  className="w-28 rounded border border-gray-300 px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span className="text-xs text-gray-400">COP</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCOP(row.netAmount)}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                          <td className="px-4 py-3 text-gray-700">Totales ({discountRows.length} propiedades)</td>
                          <td className="px-4 py-3 text-right text-gray-900">{formatCOP(totalDiscountBase)}</td>
                          <td className="px-4 py-3 text-right text-red-600">-{formatCOP(totalDiscountAmount)}</td>
                          <td className="px-4 py-3 text-right text-green-700">{formatCOP(totalDiscountNet)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="mt-4 flex justify-between">
                    <Button variant="outline" onClick={() => setCurrentStep(1)}>Volver al Paso 1</Button>
                    <Button onClick={applyDiscountsAndAdvance}>
                      Aplicar Descuentos y Continuar <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                  </>
                )}
              </div>
            </Card>
          )}

          {/* Step 3: Formats & Email */}
          {currentStep === 3 && (
            <Paso2FormatoEnvio
              liquidation={liquidation.map(r => ({
                due: r.due || ({ id: r.rowId, organization_id: activeOrg.id, unit_id: r.unit.id, type: 'ordinaria' as const, period: billingPeriod, due_date: new Date().toISOString().slice(0, 10), amount: r.currentCharges, interest_rate: r.interestRate, balance: r.priorBalance, status: 'pendiente' as const, created_at: '' }) as Due,
                unit: r.unit,
                daysLate: r.daysLate,
                interestRate: r.interestRate,
                priorBalance: r.priorBalance,
                currentCharges: r.currentCharges,
                chargeLines: r.chargeLines,
                interestAmount: r.interestAmount,
                discountAmount: r.discountAmount,
                netTotal: r.netTotal,
                totalWithInterest: r.netTotal,
                baseAmount: r.currentCharges,
                rowId: r.rowId,
              }))}
              agreements={[...agreements, ...defaultedAgreements]}
              org={activeOrg}
              billingPeriod={billingPeriod}
              onBack={() => setCurrentStep(hasDiscounts ? 2 : 1)}
              onComplete={() => setCurrentStep(4)}
            />
          )}

          {/* Step 4: Completion */}
          {currentStep === 4 && (
            <Card>
              <div className="text-center py-16">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-100 mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Proceso de Facturación Completado</h2>
                <p className="text-gray-500 mb-6">Las cuentas de cobro han sido generadas y el envío simulado ha finalizado.</p>
                <Button onClick={() => { setCurrentStep(1); setReviewed(false); setLiquidation([]); setDiscountRows([]); }}>
                  <RefreshCw className="w-4 h-4" /> Iniciar Nuevo Proceso
                </Button>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Warning Modal */}
      <Modal
        open={warningOpen}
        onClose={() => setWarningOpen(false)}
        title="Advertencia: Acuerdos de Pago Incumplidos"
        size="lg"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-4">
            <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">
                Se detectaron {defaultedAgreements.length} acuerdo(s) de pago incumplido(s)
              </p>
              <p className="text-sm text-red-700 mt-1">
                Los siguientes propiedades tienen acuerdos de pago en estado de incumplimiento.
                Revise la situación antes de proceder con la facturación.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2">Propiedad</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2 hidden sm:table-cell">Periodo Inicial</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2 hidden sm:table-cell">Periodo Final</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-2">Cuota Mensual</th>
                  <th className="text-center text-xs font-semibold text-gray-600 uppercase px-4 py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                defaultedAgreements.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{a.units?.tower} {a.units?.unit_label}</p>
                      <p className="text-xs text-gray-500">{a.units?.owner_name || ''}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 hidden sm:table-cell">{a.start_period}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 hidden sm:table-cell">{a.end_period}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-900">{formatCOP(a.monthly_amount)}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="red">Incumplido</Badge>
                    </td>
                  </tr>
                ))
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setWarningOpen(false)}>Cerrar y Revisar</Button>
            <Button onClick={() => setWarningOpen(false)}>
              <CheckCircle2 className="w-4 h-4" /> Continuar con Facturación
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}