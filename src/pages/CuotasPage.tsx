import { useEffect, useState, useCallback, useMemo } from 'react';
import { Calculator, Plus, Trash2, Loader2, AlertTriangle, Save, Table, CheckCircle2, Home, Layers } from 'lucide-react';
import { supabase, RevenuePeriod, BillingConcept, Unit, AdminQuota, AdminQuotaLine } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, revenueFrequencyLabels } from '@/lib/format';

const calcMethodLabels: Record<string, string> = {
  presupuesto: 'Presupuesto / Coeficientes',
  fijo: 'Valor Fijo Igual',
  manual: 'Manual por Unidad',
};

interface QuotaRow {
  unit_id: string;
  unit_label: string;
  tower: string;
  coefficient: number;
  computed_amount: number;
  manual_amount: string;
  is_override: boolean;
}

export default function CuotasPage() {
  const { activeOrg } = useOrg();
  const [periods, setPeriods] = useState<RevenuePeriod[]>([]);
  const [concepts, setConcepts] = useState<BillingConcept[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [selectedConceptId, setSelectedConceptId] = useState('');
  const [loading, setLoading] = useState(true);
  const [existingQuota, setExistingQuota] = useState<AdminQuota | null>(null);
  const [calcMethod, setCalcMethod] = useState<'presupuesto' | 'fijo' | 'manual'>('fijo');
  const [budgetAmount, setBudgetAmount] = useState('0');
  const [fixedAmount, setFixedAmount] = useState('0');
  const [roundingDecimals, setRoundingDecimals] = useState('2');
  const [quotaRows, setQuotaRows] = useState<QuotaRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => { if (activeOrg) loadInitial(); }, [activeOrg]);

  const loadInitial = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: periodData }, { data: conceptData }, { data: unitData }] = await Promise.all([
      supabase.from('revenue_periods').select('*').eq('organization_id', activeOrg.id).order('start_date', { ascending: false }),
      supabase.from('billing_concepts').select('*').eq('organization_id', activeOrg.id).eq('is_active', true).order('is_default', { ascending: false }).order('name'),
      supabase.from('units').select('*').eq('organization_id', activeOrg.id).eq('is_active', true).order('tower').order('unit_label'),
    ]);
    const pList = periodData || [];
    const cList = conceptData || [];
    setPeriods(pList);
    setConcepts(cList);
    setUnits(unitData || []);
    const defaultConcept = cList.find(c => c.is_default);
    setSelectedConceptId(defaultConcept?.id || cList[0]?.id || '');
    if (pList.length > 0) setSelectedPeriodId(pList[0].id);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { if (selectedPeriodId && selectedConceptId) loadExistingQuota(); }, [selectedPeriodId, selectedConceptId]);

  const loadExistingQuota = useCallback(async () => {
    if (!activeOrg || !selectedPeriodId || !selectedConceptId) return;
    const { data } = await supabase
      .from('admin_quotas')
      .select('*, admin_quota_lines(*)')
      .eq('organization_id', activeOrg.id)
      .eq('revenue_period_id', selectedPeriodId)
      .eq('billing_concept_id', selectedConceptId)
      .maybeSingle();

    if (data) {
      setExistingQuota(data);
      setCalcMethod(data.calculation_method);
      setBudgetAmount(String(data.budget_amount));
      setFixedAmount(String(data.fixed_amount));
      setRoundingDecimals(String(data.rounding_decimals));
      loadQuotaRows(data);
    } else {
      setExistingQuota(null);
      setCalcMethod('fijo');
      setBudgetAmount('0');
      setFixedAmount('0');
      setRoundingDecimals('2');
      setQuotaRows([]);
    }
    setMsg('');
    setValidationErrors([]);
  }, [activeOrg, selectedPeriodId, selectedConceptId]);

  function loadQuotaRows(quota: AdminQuota) {
    const lines = quota.admin_quota_lines || [];
    const rows: QuotaRow[] = units.map(u => {
      const line = lines.find(l => l.unit_id === u.id);
      const computed = computeAmount(u.coefficient);
      return {
        unit_id: u.id,
        unit_label: u.unit_label,
        tower: u.tower,
        coefficient: u.coefficient,
        computed_amount: computed,
        manual_amount: line ? String(line.amount) : '',
        is_override: !!line,
      };
    });
    setQuotaRows(rows);
  }

  function computeAmount(coefficient: number): number {
    const decimals = parseInt(roundingDecimals) || 2;
    const factor = Math.pow(10, decimals);
    if (calcMethod === 'presupuesto') {
      const budget = parseFloat(budgetAmount) || 0;
      const totalCoeff = units.reduce((s, u) => s + u.coefficient, 0) || 1;
      return Math.round((budget * coefficient / totalCoeff) * factor) / factor;
    }
    if (calcMethod === 'fijo') {
      const fixed = parseFloat(fixedAmount) || 0;
      return Math.round(fixed * factor) / factor;
    }
    return 0;
  }

  function regenerateRows() {
    const rows: QuotaRow[] = units.map(u => ({
      unit_id: u.id,
      unit_label: u.unit_label,
      tower: u.tower,
      coefficient: u.coefficient,
      computed_amount: computeAmount(u.coefficient),
      manual_amount: '',
      is_override: false,
    }));
    setQuotaRows(rows);
    setMsg('Cálculo generado. Revise los valores antes de guardar.');
  }

  function updateManualAmount(idx: number, value: string) {
    setQuotaRows(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], manual_amount: value, is_override: value !== '' };
      return updated;
    });
  }

  const totalQuota = useMemo(() => {
    return quotaRows.reduce((s, r) => {
      const val = r.is_override ? (parseFloat(r.manual_amount) || 0) : r.computed_amount;
      return s + val;
    }, 0);
  }, [quotaRows]);

  function validateBeforeSave(): string[] {
    const errors: string[] = [];
    if (units.length === 0) {
      errors.push('No hay unidades activas registradas para calcular cuotas.');
    }
    if (units.some(u => !u.coefficient || u.coefficient <= 0) && calcMethod === 'presupuesto') {
      errors.push('Existen unidades con coeficiente cero o no asignado. No se puede calcular por presupuesto.');
    }
    if (calcMethod === 'presupuesto' && (parseFloat(budgetAmount) || 0) <= 0) {
      errors.push('El monto del presupuesto debe ser mayor que cero.');
    }
    if (calcMethod === 'fijo' && (parseFloat(fixedAmount) || 0) <= 0) {
      errors.push('El valor fijo por unidad debe ser mayor que cero.');
    }
    if (calcMethod === 'manual') {
      const missing = quotaRows.filter(r => !r.is_override || (parseFloat(r.manual_amount) || 0) <= 0);
      if (missing.length > 0) {
        errors.push(`Faltan valores para ${missing.length} unidad(es). Todas deben tener un valor asignado.`);
      }
    }
    return errors;
  }

  async function handleSave() {
    if (!activeOrg || !selectedPeriodId || !selectedConceptId) return;
    const errors = validateBeforeSave();
    setValidationErrors(errors);
    if (errors.length > 0) return;

    setSaving(true);
    setMsg('');
    try {
      const payload = {
        organization_id: activeOrg.id,
        revenue_period_id: selectedPeriodId,
        billing_concept_id: selectedConceptId,
        calculation_method: calcMethod,
        budget_amount: parseFloat(budgetAmount) || 0,
        fixed_amount: parseFloat(fixedAmount) || 0,
        rounding_decimals: parseInt(roundingDecimals) || 2,
        is_active: true,
      };

      let quotaId: string;
      if (existingQuota) {
        const { error } = await supabase.from('admin_quotas').update(payload).eq('id', existingQuota.id);
        if (error) throw error;
        quotaId = existingQuota.id;
        await supabase.from('admin_quota_lines').delete().eq('admin_quota_id', quotaId);
      } else {
        const { data: created, error } = await supabase.from('admin_quotas').insert(payload).select().single();
        if (error) throw error;
        quotaId = created.id;
      }

      if (calcMethod === 'manual' || quotaRows.some(r => r.is_override)) {
        const linesToInsert = quotaRows
          .filter(r => r.is_override)
          .map(r => ({
            organization_id: activeOrg.id,
            admin_quota_id: quotaId,
            unit_id: r.unit_id,
            amount: parseFloat(r.manual_amount) || 0,
          }));
        if (linesToInsert.length > 0) {
          await supabase.from('admin_quota_lines').insert(linesToInsert);
        }
      }

      setMsg('Cuotas de administración guardadas correctamente.');
      setSaving(false);
      await loadExistingQuota();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Error al guardar las cuotas';
      setMsg(`Error: ${errMsg}`);
      setSaving(false);
    }
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Cuotas de Administración</h1>
        <p className="text-gray-500 mt-1">Generación de cuotas base mensuales según Ley 675 de 2001</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
      ) : periods.length === 0 ? (
        <Card><div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Calculator className="w-8 h-8 text-gray-400" /></div>
          <p className="text-gray-500">No hay periodos de recaudo configurados.</p>
          <p className="text-sm text-gray-400 mt-1">Primero cree un periodo en Calendario de Recaudo.</p>
        </div></Card>
      ) : (
        <div className="space-y-6">
          {/* Selectors */}
          <Card>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select label="Periodo de Recaudo" value={selectedPeriodId} onChange={(e) => setSelectedPeriodId(e.target.value)}>
                {periods.map(p => <option key={p.id} value={p.id}>{p.name} ({revenueFrequencyLabels[p.frequency]})</option>)}
              </Select>
              <Select label="Concepto de Cobro" value={selectedConceptId} onChange={(e) => setSelectedConceptId(e.target.value)}>
                {concepts.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </Select>
            </div>
          </Card>

          {/* Calculation Method */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Calculator className="w-5 h-5 text-blue-600" /> Método de Cálculo</h2>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(['fijo', 'presupuesto', 'manual'] as const).map(method => (
                  <button
                    key={method}
                    onClick={() => { setCalcMethod(method); setQuotaRows([]); setValidationErrors([]); }}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${calcMethod === method ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-4 h-4 rounded-full border-2 ${calcMethod === method ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`} />
                      <span className="text-sm font-semibold text-gray-900">{calcMethodLabels[method]}</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {method === 'fijo' && 'Valor igual para todas las unidades'}
                      {method === 'presupuesto' && 'Presupuesto total dividido por coeficientes'}
                      {method === 'manual' && 'Valor ingresado manualmente por unidad'}
                    </p>
                  </button>
                ))}
              </div>

              {calcMethod === 'presupuesto' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label="Monto Total del Presupuesto (COP)" type="number" value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} />
                  <Input label="Decimales de Redondeo" type="number" value={roundingDecimals} onChange={(e) => setRoundingDecimals(e.target.value)} />
                </div>
              )}
              {calcMethod === 'fijo' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label="Valor Fijo por Unidad (COP)" type="number" value={fixedAmount} onChange={(e) => setFixedAmount(e.target.value)} />
                  <Input label="Decimales de Redondeo" type="number" value={roundingDecimals} onChange={(e) => setRoundingDecimals(e.target.value)} />
                </div>
              )}
              {calcMethod === 'manual' && (
                <div>
                  <Input label="Decimales de Redondeo" type="number" value={roundingDecimals} onChange={(e) => setRoundingDecimals(e.target.value)} className="sm:max-w-xs" />
                  <p className="text-xs text-gray-500 mt-2">Ingrese el valor manualmente para cada unidad en la tabla inferior.</p>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={regenerateRows} disabled={units.length === 0}>
                  <Table className="w-4 h-4" /> Generar / Recalcular
                </Button>
                {existingQuota && <Badge variant="blue">Configuración existente</Badge>}
              </div>
            </div>
          </Card>

          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-900">No se puede generar la facturación</p>
                  <ul className="mt-1 text-sm text-red-700 list-disc list-inside">
                    {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Quota Table */}
          {quotaRows.length > 0 && (
            <Card>
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Home className="w-5 h-5 text-blue-600" /> Cuotas por Unidad</h2>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">Total: <strong className="text-gray-900">{formatCOP(totalQuota)}</strong></span>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Guardar Cuotas
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Torre</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Unidad</th>
                    <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden sm:table-cell">Coeficiente</th>
                    <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Valor Calculado</th>
                    {calcMethod === 'manual' && <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Valor Manual</th>}
                    {calcMethod !== 'manual' && <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Valor a Aplicar</th>}
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {quotaRows.map((row, idx) => {
                      const effectiveValue = row.is_override ? (parseFloat(row.manual_amount) || 0) : row.computed_amount;
                      return (
                        <tr key={row.unit_id} className="hover:bg-gray-50">
                          <td className="px-6 py-3 text-sm text-gray-700">{row.tower}</td>
                          <td className="px-6 py-3 text-sm font-medium text-gray-900">{row.unit_label}</td>
                          <td className="px-6 py-3 text-sm text-gray-500 text-right hidden sm:table-cell">{row.coefficient.toFixed(4)}</td>
                          <td className="px-6 py-3 text-sm text-gray-700 text-right">{formatCOP(row.computed_amount)}</td>
                          {calcMethod === 'manual' ? (
                            <td className="px-6 py-3 text-right">
                              <input
                                type="number"
                                value={row.manual_amount}
                                onChange={(e) => updateManualAmount(idx, e.target.value)}
                                placeholder="0"
                                className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </td>
                          ) : (
                            <td className="px-6 py-3 text-right">
                              {row.is_override ? (
                                <span className="text-sm font-medium text-blue-600">{formatCOP(parseFloat(row.manual_amount) || 0)}</span>
                              ) : (
                                <span className="text-sm text-gray-900">{formatCOP(effectiveValue)}</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={calcMethod === 'manual' ? 4 : 4} className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">Total Cuotas:</td>
                    <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">{formatCOP(totalQuota)}</td>
                  </tr></tfoot>
                </table>
              </div>
            </Card>
          )}

          {/* Messages */}
          {msg && (
            <div className={`rounded-lg p-4 ${msg.startsWith('Error') ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
              <div className="flex items-center gap-2">
                {msg.startsWith('Error') ? <AlertTriangle className="w-5 h-5 text-red-600" /> : <CheckCircle2 className="w-5 h-5 text-green-600" />}
                <p className={`text-sm ${msg.startsWith('Error') ? 'text-red-700' : 'text-green-700'}`}>{msg}</p>
              </div>
            </div>
          )}

          {/* Info banner */}
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
            <p className="text-sm text-blue-800 flex items-start gap-2">
              <Layers className="w-4 h-4 mt-0.5 flex-shrink-0" />
              Las cuotas de administración se calculan según el método seleccionado. No se puede generar facturación si hay unidades con coeficientes no asignados (método presupuesto) o valores en cero (método manual).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
