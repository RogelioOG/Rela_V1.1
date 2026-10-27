import { useEffect, useState, useCallback, useMemo } from 'react';
import { Percent, Plus, Trash2, Loader2, Layers, Table, Save, AlertTriangle, Calendar, Home } from 'lucide-react';
import { supabase, RevenuePeriod, DiscountTier, Unit, BillingConcept } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, formatNumber, revenueFrequencyLabels } from '@/lib/format';

interface TierFormState {
  id?: string;
  tier_order: number;
  name: string;
  discount_type: 'porcentaje' | 'monto';
  discount_value: string;
  valid_until_day: string;
  is_active: boolean;
}

interface PreBillRow {
  unit_id: string;
  unit_label: string;
  tower: string;
  coefficient: number;
  base_amount: number;
  applied_tier: DiscountTier | null;
  discount_amount: number;
  net_amount: number;
  manual_override: boolean;
  override_discount: string;
}

export default function DescuentosPage() {
  const { activeOrg } = useOrg();
  const [periods, setPeriods] = useState<RevenuePeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [tiers, setTiers] = useState<DiscountTier[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [concepts, setConcepts] = useState<BillingConcept[]>([]);
  const [selectedConceptId, setSelectedConceptId] = useState('');
  const [loading, setLoading] = useState(true);
  const [tierForms, setTierForms] = useState<TierFormState[]>([]);
  const [savingTiers, setSavingTiers] = useState(false);
  const [tierMsg, setTierMsg] = useState('');
  const [preBillRows, setPreBillRows] = useState<PreBillRow[]>([]);
  const [totalBase, setTotalBase] = useState(0);
  const [totalDiscount, setTotalDiscount] = useState(0);
  const [totalNet, setTotalNet] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [billingMsg, setBillingMsg] = useState('');

  useEffect(() => { if (activeOrg) loadInitial(); }, [activeOrg]);

  const loadInitial = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: periodData }, { data: unitData }, { data: conceptData }] = await Promise.all([
      supabase.from('revenue_periods').select('*').eq('organization_id', activeOrg.id).order('start_date', { ascending: false }),
      supabase.from('units').select('*').eq('organization_id', activeOrg.id).eq('is_active', true).order('tower').order('unit_label'),
      supabase.from('billing_concepts').select('*').eq('organization_id', activeOrg.id).eq('is_active', true).order('is_default', { ascending: false }).order('name'),
    ]);
    const pList = periodData || [];
    setPeriods(pList);
    setUnits(unitData || []);
    const cList = conceptData || [];
    setConcepts(cList);
    const defaultConcept = cList.find(c => c.is_default);
    setSelectedConceptId(defaultConcept?.id || cList[0]?.id || '');
    if (pList.length > 0) setSelectedPeriodId(pList[0].id);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { if (selectedPeriodId) loadTiers(); }, [selectedPeriodId]);

  const loadTiers = useCallback(async () => {
    if (!selectedPeriodId) { setTiers([]); setTierForms([]); return; }
    const { data } = await supabase
      .from('discount_tiers')
      .select('*')
      .eq('revenue_period_id', selectedPeriodId)
      .order('tier_order', { ascending: true });
    const list = data || [];
    setTiers(list);
    setTierForms(list.map(t => ({
      id: t.id,
      tier_order: t.tier_order,
      name: t.name,
      discount_type: t.discount_type,
      discount_value: String(t.discount_value),
      valid_until_day: String(t.valid_until_day),
      is_active: t.is_active,
    })));
  }, [selectedPeriodId]);

  function addTier() {
    const nextOrder = tierForms.length > 0 ? Math.max(...tierForms.map(t => t.tier_order)) + 1 : 1;
    setTierForms([...tierForms, {
      tier_order: nextOrder,
      name: `Escalón ${nextOrder}`,
      discount_type: 'porcentaje',
      discount_value: '0',
      valid_until_day: '5',
      is_active: true,
    }]);
  }

  function updateTier(idx: number, field: keyof TierFormState, value: string | boolean | number) {
    setTierForms(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  }

  function removeTier(idx: number) {
    setTierForms(prev => prev.filter((_, i) => i !== idx).map((t, i) => ({ ...t, tier_order: i + 1 })));
  }

  async function saveTiers() {
    if (!activeOrg || !selectedPeriodId) return;
    setSavingTiers(true);
    setTierMsg('');
    try {
      const existingIds = tiers.map(t => t.id);
      const formIds = tierForms.filter(f => f.id).map(f => f.id);
      const toDelete = existingIds.filter(id => !formIds.includes(id));
      if (toDelete.length > 0) {
        await supabase.from('discount_tiers').delete().in('id', toDelete);
      }
      for (const form of tierForms) {
        const payload = {
          organization_id: activeOrg.id,
          revenue_period_id: selectedPeriodId,
          tier_order: form.tier_order,
          name: form.name,
          discount_type: form.discount_type,
          discount_value: parseFloat(form.discount_value) || 0,
          valid_until_day: parseInt(form.valid_until_day) || 1,
          is_active: form.is_active,
        };
        if (form.id) {
          const { error } = await supabase.from('discount_tiers').update(payload).eq('id', form.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('discount_tiers').insert(payload);
          if (error) throw error;
        }
      }
      await loadTiers();
      setTierMsg('Descuentos guardados correctamente.');
      setSavingTiers(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar los descuentos';
      setTierMsg(`Error: ${msg}`);
      setSavingTiers(false);
    }
  }

  // Pre-billing discount calculation
  const activeTiers = useMemo(() => tiers.filter(t => t.is_active).sort((a, b) => a.valid_until_day - b.valid_until_day), [tiers]);

  function generatePreBill() {
    if (units.length === 0 || !selectedConceptId) {
      setBillingMsg('No hay unidades o concepto seleccionado para generar el pre-facturación.');
      return;
    }
    setGenerating(true);
    const concept = concepts.find(c => c.id === selectedConceptId);
    const conceptName = concept?.name || 'Concepto';

    // Use period billing_day as reference. Base amount = coefficient * base fee.
    // For demo, base fee = $500,000 COP per 1.0 coefficient
    const baseFee = 500000;
    const today = new Date().getDate();

    const rows: PreBillRow[] = units.map(u => {
      const base_amount = u.coefficient * baseFee;
      let appliedTier: DiscountTier | null = null;
      for (const tier of activeTiers) {
        if (today <= tier.valid_until_day) {
          appliedTier = tier;
          break;
        }
      }
      let discount_amount = 0;
      if (appliedTier) {
        if (appliedTier.discount_type === 'porcentaje') {
          discount_amount = base_amount * (appliedTier.discount_value / 100);
        } else {
          discount_amount = Math.min(appliedTier.discount_value, base_amount);
        }
      }
      return {
        unit_id: u.id,
        unit_label: u.unit_label,
        tower: u.tower,
        coefficient: u.coefficient,
        base_amount,
        applied_tier: appliedTier,
        discount_amount,
        net_amount: base_amount - discount_amount,
        manual_override: false,
        override_discount: '',
      };
    });

    setPreBillRows(rows);
    setBillingMsg(`Pre-facturación generada para ${rows.length} unidades — Concepto: ${conceptName}. Ajuste los descuentos manualmente si lo desea.`);
    setGenerating(false);
  }

  function applyManualDiscount(idx: number, discountStr: string) {
    setPreBillRows(prev => {
      const updated = [...prev];
      const row = updated[idx];
      const overrideVal = parseFloat(discountStr) || 0;
      let newDiscount: number;
      if (discountStr === '') {
        // Revert to auto
        newDiscount = row.applied_tier
          ? row.applied_tier.discount_type === 'porcentaje'
            ? row.base_amount * (row.applied_tier.discount_value / 100)
            : Math.min(row.applied_tier.discount_value, row.base_amount)
          : 0;
        updated[idx] = {
          ...row,
          discount_amount: newDiscount,
          net_amount: row.base_amount - newDiscount,
          manual_override: false,
          override_discount: '',
        };
      } else {
        newDiscount = Math.min(overrideVal, row.base_amount);
        updated[idx] = {
          ...row,
          discount_amount: newDiscount,
          net_amount: row.base_amount - newDiscount,
          manual_override: true,
          override_discount: discountStr,
        };
      }
      return updated;
    });
  }

  // Recalculate totals when preBillRows change
  useEffect(() => {
    const base = preBillRows.reduce((s, r) => s + r.base_amount, 0);
    const disc = preBillRows.reduce((s, r) => s + r.discount_amount, 0);
    setTotalBase(base);
    setTotalDiscount(disc);
    setTotalNet(base - disc);
  }, [preBillRows]);

  if (!activeOrg) return <NoOrgSelected />;

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Descuentos por Pronto Pago</h1>
        <p className="text-gray-500 mt-1">Descuentos escalonados configurables por periodo y pre-facturación interactiva</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
      ) : periods.length === 0 ? (
        <Card><div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Calendar className="w-8 h-8 text-gray-400" /></div>
          <p className="text-gray-500">No hay periodos de recaudo configurados.</p>
          <p className="text-sm text-gray-400 mt-1">Primero cree un periodo en Calendario de Recaudo para configurar descuentos.</p>
        </div></Card>
      ) : (
        <div className="space-y-6">
          {/* Period selector */}
          <Card>
            <div className="p-5 flex flex-col sm:flex-row sm:items-end gap-4">
              <Select label="Periodo de Recaudo" value={selectedPeriodId} onChange={(e) => setSelectedPeriodId(e.target.value)} className="sm:max-w-xs">
                {periods.map(p => <option key={p.id} value={p.id}>{p.name} ({revenueFrequencyLabels[p.frequency]})</option>)}
              </Select>
              {selectedPeriod && (
                <div className="text-sm text-gray-500">
                  Vencimiento día <strong>{selectedPeriod.due_day}</strong> · Gracia: {selectedPeriod.grace_days} días
                </div>
              )}
            </div>
          </Card>

          {/* Tier Configuration */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Layers className="w-5 h-5 text-blue-600" /> Escalones de Descuento</h2>
              <Button size="sm" variant="outline" onClick={addTier}><Plus className="w-4 h-4" /> Agregar Escalón</Button>
            </div>
            <div className="p-5">
              {tierForms.length === 0 ? (
                <div className="text-center py-8">
                  <Percent className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No hay escalones configurados. Agregue escalones de descuento por pronto pago.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tierForms.map((tier, idx) => (
                    <div key={idx} className="rounded-lg border border-gray-200 p-4 bg-gray-50">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-gray-600 uppercase">Escalón {tier.tier_order}</span>
                        <button type="button" onClick={() => removeTier(idx)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <Input label="Nombre" value={tier.name} onChange={(e) => updateTier(idx, 'name', e.target.value)} placeholder="Ej: Pronto Pago Nivel 1" />
                        <Select label="Tipo de Descuento" value={tier.discount_type} onChange={(e) => updateTier(idx, 'discount_type', e.target.value)}>
                          <option value="porcentaje">Porcentaje (%)</option>
                          <option value="monto">Monto Fijo (COP)</option>
                        </Select>
                        <Input label="Valor" type="number" step="0.01" value={tier.discount_value} onChange={(e) => updateTier(idx, 'discount_value', e.target.value)} placeholder="Ej: 15" />
                        <Input label="Válido Hasta el Día" type="number" min="1" max="31" value={tier.valid_until_day} onChange={(e) => updateTier(idx, 'valid_until_day', e.target.value)} />
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer mt-2">
                        <input type="checkbox" checked={tier.is_active} onChange={(e) => updateTier(idx, 'is_active', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        <span className="text-xs text-gray-700">Escalón activo</span>
                      </label>
                    </div>
                  ))}
                </div>
              )}
              {tierForms.length > 0 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                  {tierMsg && (
                    <p className={`text-sm ${tierMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{tierMsg}</p>
                  )}
                  <div className="ml-auto">
                    <Button onClick={saveTiers} disabled={savingTiers}>
                      {savingTiers ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : <><Save className="w-4 h-4" /> Guardar Escalones</>}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Tier Summary */}
          {activeTiers.length > 0 && (
            <Card>
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Resumen de Escalones Activos</h2>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {activeTiers.map((tier, idx) => (
                    <div key={tier.id} className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-blue-900">Escalón {tier.tier_order}</span>
                        <Badge variant="blue">Hasta día {tier.valid_until_day}</Badge>
                      </div>
                      <p className="text-2xl font-bold text-blue-700">
                        {tier.discount_type === 'porcentaje' ? `${tier.discount_value}%` : formatCOP(tier.discount_value)}
                      </p>
                      <p className="text-xs text-blue-600 mt-1">{tier.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* Pre-billing Adjustment Table */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Table className="w-5 h-5 text-blue-600" /> Pre-Facturación con Descuentos</h2>
              <div className="flex items-end gap-3">
                <Select label="Concepto" value={selectedConceptId} onChange={(e) => setSelectedConceptId(e.target.value)} className="sm:max-w-xs">
                  {concepts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Button onClick={generatePreBill} disabled={generating || units.length === 0}>
                  {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generando...</> : <><Table className="w-4 h-4" /> Generar Pre-Facturación</>}
                </Button>
              </div>
            </div>
            <div className="p-5">
              {units.length === 0 ? (
                <div className="text-center py-8">
                  <Home className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No hay unidades activas. Registre inmuebles para generar pre-facturación.</p>
                </div>
              ) : preBillRows.length === 0 ? (
                <div className="text-center py-8">
                  <Table className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Haga clic en "Generar Pre-Facturación" para calcular los descuentos por unidad.</p>
                </div>
              ) : (
                <>
                  {billingMsg && (
                    <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-blue-800">{billingMsg}</p>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Unidad</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Coeficiente</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Base</th>
                        <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3 hidden md:table-cell">Escalón</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Descuento</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Neto a Pagar</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {preBillRows.map((row, idx) => (
                          <tr key={row.unit_id} className={`hover:bg-gray-50 ${row.manual_override ? 'bg-amber-50' : ''}`}>
                            <td className="px-4 py-3">
                              <p className="font-medium text-gray-900">{row.unit_label}</p>
                              <p className="text-xs text-gray-500">{row.tower || 'Sin torre'}</p>
                            </td>
                            <td className="px-4 py-3 text-right text-gray-700">{formatNumber(row.coefficient, 4)}</td>
                            <td className="px-4 py-3 text-right text-gray-700">{formatCOP(row.base_amount)}</td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              {row.applied_tier ? (
                                <Badge variant="blue">{row.applied_tier.name} (día {row.applied_tier.valid_until_day})</Badge>
                              ) : <Badge variant="gray">Sin descuento</Badge>}
                              {row.manual_override && <div><Badge variant="yellow">Manual</Badge></div>}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={row.manual_override ? row.override_discount : ''}
                                  onChange={(e) => applyManualDiscount(idx, e.target.value)}
                                  placeholder={formatNumber(row.discount_amount, 0)}
                                  className="w-24 rounded border border-gray-300 px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span className="text-xs text-gray-400">COP</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCOP(row.net_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                          <td colSpan={2} className="px-4 py-3 text-gray-700">Totales ({preBillRows.length} unidades)</td>
                          <td className="px-4 py-3 text-right text-gray-900">{formatCOP(totalBase)}</td>
                          <td className="px-4 py-3 hidden md:table-cell"></td>
                          <td className="px-4 py-3 text-right text-red-600">-{formatCOP(totalDiscount)}</td>
                          <td className="px-4 py-3 text-right text-green-700">{formatCOP(totalNet)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
                    <p className="text-xs text-gray-600">
                      <strong>Instrucciones:</strong> Los descuentos se calculan automáticamente según el día actual y los escalones configurados.
                      Para anular el descuento automático, ingrese un valor manual en la columna "Descuento".
                      Deje el campo vacío para revertir al cálculo automático.
                    </p>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
