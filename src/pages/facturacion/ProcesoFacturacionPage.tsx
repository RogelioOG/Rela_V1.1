import { useEffect, useState, useMemo, useCallback } from 'react';
import { Calculator, Loader2, AlertTriangle, CheckCircle2, Info, Clock, Percent, RefreshCw, ChevronRight } from 'lucide-react';
import { supabase, Unit, Due, PaymentAgreement } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, formatShortDate } from '@/lib/format';

interface LiquidationRow {
  due: Due;
  unit: Unit;
  daysLate: number;
  baseAmount: number;
  interestRate: number;
  interestAmount: number;
  totalWithInterest: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function getDaysLate(dueDate: string, graceDays: number): number {
  const today = new Date();
  const due = new Date(dueDate);
  const days = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, days - graceDays);
}

const STEPS = [
  { num: 1, label: 'Configuración de Intereses' },
  { num: 2, label: 'Revisión de Liquidación' },
  { num: 3, label: 'Generación de Facturación' },
];

export default function ProcesoFacturacionPage() {
  const { activeOrg } = useOrg();
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);

  const [interestRate, setInterestRate] = useState('0.50');
  const [graceDays, setGraceDays] = useState('5');
  const [billingPeriod, setBillingPeriod] = useState(new Date().toISOString().slice(0, 7));

  const [dues, setDues] = useState<Due[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [agreements, setAgreements] = useState<PaymentAgreement[]>([]);
  const [defaultedAgreements, setDefaultedAgreements] = useState<PaymentAgreement[]>([]);

  const [reviewing, setReviewing] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [liquidation, setLiquidation] = useState<LiquidationRow[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: duesData }, { data: unitsData }, { data: agrData }] = await Promise.all([
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
    ]);
    setDues((duesData || []) as Due[]);
    setUnits((unitsData || []) as Unit[]);
    setAgreements((agrData || []) as PaymentAgreement[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { if (activeOrg) loadData(); }, [activeOrg, loadData]);

  const computedLiquidation: LiquidationRow[] = useMemo(() => {
    const rate = parseFloat(interestRate) || 0;
    const grace = parseInt(graceDays) || 0;
    const unitMap = new Map(units.map(u => [u.id, u]));
    return dues.map(due => {
      const unit = unitMap.get(due.unit_id) || due.units || ({} as Unit);
      const days = getDaysLate(due.due_date, grace);
      const base = due.balance;
      const interest = round2(base * (rate / 100) * days);
      return {
        due,
        unit,
        daysLate: days,
        baseAmount: base,
        interestRate: rate,
        interestAmount: interest,
        totalWithInterest: round2(base + interest),
      };
    });
  }, [dues, units, interestRate, graceDays]);

  const totalBase = useMemo(() => computedLiquidation.reduce((s, r) => s + r.baseAmount, 0), [computedLiquidation]);
  const totalInterest = useMemo(() => computedLiquidation.reduce((s, r) => s + r.interestAmount, 0), [computedLiquidation]);
  const totalGeneral = useMemo(() => computedLiquidation.reduce((s, r) => s + r.totalWithInterest, 0), [computedLiquidation]);

  function handleInterestRateChange(value: string) {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) { setInterestRate(''); return; }
    const rounded = Math.round(parsed * 100) / 100;
    setInterestRate(String(rounded));
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
      const defaultedAgreements = (defaulted || []) as PaymentAgreement[];
      setDefaultedAgreements(defaultedAgreements);

      const rate = parseFloat(interestRate) || 0;
      const grace = parseInt(graceDays) || 0;
      const unitMap = new Map(units.map(u => [u.id, u]));
      const rows: LiquidationRow[] = dues.map(due => {
        const unit = unitMap.get(due.unit_id) || due.units || ({} as Unit);
        const days = getDaysLate(due.due_date, grace);
        const base = due.balance;
        const interest = round2(base * (rate / 100) * days);
        return {
          due,
          unit,
          daysLate: days,
          baseAmount: base,
          interestRate: rate,
          interestAmount: interest,
          totalWithInterest: round2(base + interest),
        };
      });
      setLiquidation(rows);
      setReviewed(true);

      if (defaultedAgreements.length > 0) {
        setWarningOpen(true);
      }
      setReviewing(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al revisar la liquidación';
      setError(msg);
      setReviewing(false);
    }
  }

  function handleRowInterestChange(dueId: string, newRate: number) {
    setLiquidation(prev =>
      prev.map(row => {
        if (row.due.id !== dueId) return row;
        const interest = round2(row.baseAmount * (newRate / 100) * row.daysLate);
        return {
          ...row,
          interestRate: newRate,
          interestAmount: interest,
          totalWithInterest: round2(row.baseAmount + interest),
        };
      })
    );
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Proceso de Facturación</h1>
        <p className="text-gray-500 mt-1">Generación de facturación con cálculo de intereses de mora</p>
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
          {/* Step 1: Configuration */}
          <Card className="mb-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Percent className="w-5 h-5 text-blue-600" />
                Paso 1: Configuración de Intereses
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Defina los parámetros para el cálculo de intereses de mora sobre saldos pendientes.
              </p>
            </div>
            <CardBody>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  label="Tasa de Interés Diario (%)"
                  type="number"
                  step="0.01"
                  min="0"
                  max="99.99"
                  value={interestRate}
                  onChange={(e) => handleInterestRateChange(e.target.value)}
                  placeholder="Ej: 0.50"
                />
                <Input
                  label="Días de Gracia"
                  type="number"
                  min="0"
                  value={graceDays}
                  onChange={(e) => setGraceDays(e.target.value)}
                  placeholder="Ej: 5"
                />
                <Input
                  label="Periodo de Facturación (YYYY-MM)"
                  type="text"
                  value={billingPeriod}
                  onChange={(e) => setBillingPeriod(e.target.value)}
                  placeholder="Ej: 2026-10"
                />
              </div>

              <div className="mt-4 flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  La tasa de interés se aplica diariamente sobre el saldo pendiente después de los días de gracia.
                  Máximo 2 decimales. Se detectarán acuerdos de pago incumplidos antes de continuar.
                </p>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Button onClick={handleReviewLiquidation} disabled={reviewing || dues.length === 0}>
                  {reviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                  Revisar Liquidación
                </Button>
                {dues.length === 0 && (
                  <span className="text-sm text-gray-500">No hay cuotas pendientes para liquidar</span>
                )}
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
            </CardBody>
          </Card>

          {/* Summary Cards */}
          {reviewed && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <Card><CardBody>
                <p className="text-sm text-gray-500">Saldo Base</p>
                <p className="text-xl font-bold text-gray-900">{formatCOP(totalBase)}</p>
              </CardBody></Card>
              <Card><CardBody>
                <p className="text-sm text-gray-500">Total Intereses</p>
                <p className="text-xl font-bold text-yellow-600">{formatCOP(totalInterest)}</p>
              </CardBody></Card>
              <Card><CardBody>
                <p className="text-sm text-gray-500">Total a Facturar</p>
                <p className="text-xl font-bold text-blue-700">{formatCOP(totalGeneral)}</p>
              </CardBody></Card>
            </div>
          )}

          {/* Liquidation Table */}
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
              {liquidation.length === 0 ? (
                <div className="text-center py-12">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-100 mb-3">
                    <Clock className="w-7 h-7 text-gray-400" />
                  </div>
                  <p className="text-gray-500">No hay cuotas pendientes para liquidar en este periodo</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Propiedad</th>
                        <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Periodo</th>
                        <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Vencimiento</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Saldo Base</th>
                        <th className="text-center text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden sm:table-cell">Días Mora</th>
                        <th className="text-center text-xs font-semibold text-gray-600 uppercase px-6 py-3">Tasa (%)</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Interés</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {liquidation.map((row) => (
                        <tr key={row.due.id} className="hover:bg-gray-50">
                          <td className="px-6 py-3">
                            <p className="text-sm font-medium text-gray-900">{row.unit.tower} {row.unit.unit_label}</p>
                            <p className="text-xs text-gray-500">{row.unit.owner_name || ''}</p>
                          </td>
                          <td className="px-6 py-3 text-sm text-gray-700 hidden md:table-cell">{row.due.period}</td>
                          <td className="px-6 py-3 text-sm text-gray-700 hidden lg:table-cell">{formatShortDate(row.due.due_date)}</td>
                          <td className="px-6 py-3 text-right text-sm text-gray-900">{formatCOP(row.baseAmount)}</td>
                          <td className="px-6 py-3 text-center hidden sm:table-cell">
                            {row.daysLate > 0 ? (
                              <Badge variant="red">{row.daysLate}</Badge>
                            ) : (
                              <Badge variant="gray">0</Badge>
                            )}
                          </td>
                          <td className="px-6 py-3 text-center">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={row.interestRate}
                              onChange={(e) => {
                                const val = Math.round((parseFloat(e.target.value) || 0) * 100) / 100;
                                handleRowInterestChange(row.due.id, val);
                              }}
                              className="w-20 text-center text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </td>
                          <td className="px-6 py-3 text-right text-sm font-medium text-yellow-600">{formatCOP(row.interestAmount)}</td>
                          <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">{formatCOP(row.totalWithInterest)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td colSpan={3} className="px-6 py-3 text-sm font-semibold text-gray-900 text-right hidden md:table-cell">Totales:</td>
                        <td className="px-6 py-3 text-right text-sm font-bold text-gray-900 md:hidden">Totales:</td>
                        <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">{formatCOP(totalBase)}</td>
                        <td colSpan={2} className="px-6 py-3" />
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

      {/* Warning Modal: Defaulted Payment Agreements */}
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
                Revise la situación antes de proceder con la facturación, ya que los saldos
                pueden estar sujetos a tratamiento especial.
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
                {defaultedAgreements.map((a) => (
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
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200">
            <Info className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-700">
              Puede continuar con el proceso de facturación, pero se recomienda regularizar
              los acuerdos incumplidos antes de emitir nuevas facturas.
            </p>
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
