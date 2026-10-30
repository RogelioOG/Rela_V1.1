import { useEffect, useState, useCallback, useMemo } from 'react';
import { Percent, Plus, Trash2, Loader2, Layers, Save, CheckSquare, Square } from 'lucide-react';
import { supabase, DiscountTier, BillingConcept } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP } from '@/lib/format';

interface TierFormState {
  id?: string;
  tier_order: number;
  name: string;
  discount_type: 'porcentaje' | 'monto';
  discount_value: string;
  valid_until_day: string;
  is_active: boolean;
  calculation_base_concept_ids: string[];
}

export default function DescuentosPage() {
  const { activeOrg } = useOrg();
  const [tiers, setTiers] = useState<DiscountTier[]>([]);
  const [concepts, setConcepts] = useState<BillingConcept[]>([]);
  const [loading, setLoading] = useState(true);
  const [tierForms, setTierForms] = useState<TierFormState[]>([]);
  const [savingTiers, setSavingTiers] = useState(false);
  const [tierMsg, setTierMsg] = useState('');

  useEffect(() => { if (activeOrg) loadInitial(); }, [activeOrg, loadInitial]);

  const loadInitial = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: tierData }, { data: conceptData }] = await Promise.all([
      supabase
        .from('discount_tiers')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .order('tier_order', { ascending: true }),
      supabase
        .from('billing_concepts')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name'),
    ]);
    setConcepts(conceptData || []);
    const list = (tierData || []) as DiscountTier[];
    setTiers(list);
    setTierForms(list.map(t => ({
      id: t.id,
      tier_order: t.tier_order,
      name: t.name,
      discount_type: t.discount_type,
      discount_value: String(t.discount_value),
      valid_until_day: String(t.valid_until_day),
      is_active: t.is_active,
      calculation_base_concept_ids: t.calculation_base_concept_ids || [],
    })));
    setLoading(false);
  }, [activeOrg]);

  function addTier() {
    setTierForms(prev => {
      const nextOrder = prev.length > 0 ? Math.max(...prev.map(t => t.tier_order)) + 1 : 1;
      return [...prev, {
        tier_order: nextOrder,
        name: `Escalón ${nextOrder}`,
        discount_type: 'porcentaje',
        discount_value: '0',
        valid_until_day: '5',
        is_active: true,
        calculation_base_concept_ids: [],
      }];
    });
  }

  function updateTier(idx: number, field: keyof TierFormState, value: string | boolean | number | string[]) {
    setTierForms(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  }

  function toggleConceptInTier(idx: number, conceptId: string) {
    setTierForms(prev => {
      const updated = [...prev];
      const current = updated[idx].calculation_base_concept_ids;
      if (current.includes(conceptId)) {
        updated[idx] = { ...updated[idx], calculation_base_concept_ids: current.filter(id => id !== conceptId) };
      } else {
        updated[idx] = { ...updated[idx], calculation_base_concept_ids: [...current, conceptId] };
      }
      return updated;
    });
  }

  function removeTier(idx: number) {
    setTierForms(prev => prev.filter((_, i) => i !== idx).map((t, i) => ({ ...t, tier_order: i + 1 })));
  }

  async function saveTiers() {
    if (!activeOrg) return;
    setSavingTiers(true);
    setTierMsg('');
    try {
      const existingIds = tiers.map(t => t.id);
      const formIds = tierForms.filter(f => f.id).map(f => f.id);
      const toDelete = existingIds.filter(id => !formIds.includes(id));
      
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.from('discount_tiers').delete().in('id', toDelete);
        if (delErr) throw delErr;
      }

      for (let i = 0; i < tierForms.length; i++) {
        const form = tierForms[i];
        const payload = {
          organization_id: activeOrg.id,
          tier_order: i + 1, // Forzamos un orden secuencial limpio basado en la posición actual
          name: form.name?.trim() || `Escalón ${i + 1}`,
          discount_type: form.discount_type,
          discount_value: parseFloat(form.discount_value) || 0,
          valid_until_day: parseInt(form.valid_until_day) || 1,
          is_active: form.is_active,
          calculation_base_concept_ids: form.discount_type === 'porcentaje'
            ? (form.calculation_base_concept_ids || [])
            : [],
        };

        if (form.id) {
          const { error } = await supabase.from('discount_tiers').update(payload).eq('id', form.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('discount_tiers').insert(payload);
          if (error) throw error;
        }
      }

      await loadInitial();
      setTierMsg('Descuentos guardados correctamente.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar los descuentos';
      setTierMsg(`Error: ${msg}`);
    } finally {
      setSavingTiers(false);
    }
  }

  const activeTiers = useMemo(() => tiers.filter(t => t.is_active).sort((a, b) => a.valid_until_day - b.valid_until_day), [tiers]);

  function conceptLabel(id: string): string {
    const c = concepts.find(con => con.id === id);
    return c ? `${c.code} — ${c.name}` : 'N/A';
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Descuentos por Pronto Pago</h1>
        <p className="text-gray-500 mt-1">Configuración de escalones de descuento y base de cálculo</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
      ) : (
        <div className="space-y-6">
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
                    <div key={tier.id || `new-${idx}`} className="rounded-lg border border-gray-200 p-4 bg-gray-50">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-gray-600 uppercase">Escalón {idx + 1}</span>
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

                      {/* Calculation base multi-select — only for percentage type */}
                      {tier.discount_type === 'porcentaje' && (
                        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                          <p className="text-xs font-semibold text-gray-700 mb-2">Base de Cálculo — Conceptos a los que aplica el porcentaje:</p>
                          <p className="text-xs text-gray-500 mb-2">Deje sin seleccionar para usar "Valor Total" (todos los conceptos). Seleccione conceptos específicos para aplicar el descuento solo sobre esos valores.</p>
                          <div className="flex flex-wrap gap-2">
                            {concepts.map(c => {
                              const checked = tier.calculation_base_concept_ids.includes(c.id);
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => toggleConceptInTier(idx, c.id)}
                                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                                    checked
                                      ? 'border-blue-500 bg-blue-100 text-blue-800'
                                      : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                                  }`}
                                >
                                  {checked ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                  {c.code} — {c.name}
                                </button>
                              );
                            })}
                          </div>
                          {tier.calculation_base_concept_ids.length === 0 && (
                            <p className="text-xs text-blue-600 mt-2 font-medium">Base: Valor Total (todos los conceptos)</p>
                          )}
                          {tier.calculation_base_concept_ids.length > 0 && (
                            <p className="text-xs text-blue-600 mt-2 font-medium">{tier.calculation_base_concept_ids.length} concepto(s) seleccionado(s)</p>
                          )}
                        </div>
                      )}

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
                  {activeTiers.map((tier) => (
                    <div key={tier.id} className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-blue-900">Escalón {tier.tier_order}</span>
                        <Badge variant="blue">Hasta día {tier.valid_until_day}</Badge>
                      </div>
                      <p className="text-2xl font-bold text-blue-700">
                        {tier.discount_type === 'porcentaje' ? `${tier.discount_value}%` : formatCOP(tier.discount_value)}
                      </p>
                      <p className="text-xs text-blue-600 mt-1">{tier.name}</p>
                      {tier.discount_type === 'porcentaje' && (
                        <div className="mt-2 pt-2 border-t border-blue-200">
                          <p className="text-xs text-blue-600 font-medium">Base de cálculo:</p>
                          {tier.calculation_base_concept_ids && tier.calculation_base_concept_ids.length > 0 ? (
                            <ul className="text-xs text-blue-700 mt-1 space-y-0.5">
                              {tier.calculation_base_concept_ids.map(id => <li key={id}>• {conceptLabel(id)}</li>)}
                            </ul>
                          ) : (
                            <p className="text-xs text-blue-700 mt-1">Valor Total (todos los conceptos)</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}