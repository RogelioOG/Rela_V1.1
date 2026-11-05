import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Layers, Save, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { supabase, BillingConcept, PaymentHierarchyConfig as HierarchyConfigRow } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { NoOrgSelected } from '@/components/shared';
import { billingCategoryLabels } from '@/lib/format';

interface PriorityRow {
  concept: BillingConcept;
  priority: string;
}

export function PaymentHierarchyConfig() {
  const { activeOrg } = useOrg();
  const [rows, setRows] = useState<PriorityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  const loadData = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    setLoadError('');

    const [conceptsRes, configsRes] = await Promise.all([
      supabase
        .from('billing_concepts')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('payment_hierarchy_configs')
        .select('*')
        .eq('organization_id', activeOrg.id),
    ]);

    if (conceptsRes.error || configsRes.error) {
      setLoadError('No se pudo cargar la prelación de pagos. Intente nuevamente.');
      setLoading(false);
      return;
    }

    const configs = (configsRes.data || []) as HierarchyConfigRow[];
    const priorityByConcept = new Map(configs.map(c => [c.concept_id, c.priority_order]));
    const concepts = (conceptsRes.data || []) as BillingConcept[];

    setRows(concepts.map(concept => {
      const p = priorityByConcept.get(concept.id);
      return { concept, priority: p === null || p === undefined ? '' : String(p) };
    }));
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { loadData(); }, [loadData]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const pa = a.priority === '' ? Number.POSITIVE_INFINITY : Number(a.priority);
      const pb = b.priority === '' ? Number.POSITIVE_INFINITY : Number(b.priority);
      if (pa !== pb) return pa - pb;
      return a.concept.name.localeCompare(b.concept.name);
    });
  }, [rows]);

  function updatePriority(conceptId: string, value: string) {
    setSaved(false);
    setRows(prev => prev.map(r => r.concept.id === conceptId ? { ...r, priority: value } : r));
  }

  function validatePriorities(): string | null {
    const used = new Set<number>();
    for (const r of rows) {
      if (r.priority === '') continue;
      const n = Number(r.priority);
      if (!Number.isInteger(n) || n < 1) {
        return `La prioridad de "${r.concept.name}" debe ser un número entero mayor o igual a 1.`;
      }
      if (used.has(n)) {
        return `La prioridad ${n} está asignada a más de un concepto. Cada prioridad debe ser única.`;
      }
      used.add(n);
    }
    return null;
  }

  async function handleSave() {
    if (!activeOrg) return;
    const validationError = validatePriorities();
    if (validationError) {
      setSaveError(validationError);
      setSaved(false);
      return;
    }

    setSaving(true);
    setSaveError('');
    setSaved(false);

    const { data: existing, error: existingErr } = await supabase
      .from('payment_hierarchy_configs')
      .select('id, concept_id')
      .eq('organization_id', activeOrg.id);

    if (existingErr) {
      setSaveError('No se pudo guardar la prelación de pagos. Intente nuevamente.');
      setSaving(false);
      return;
    }

    const existingByConcept = new Map((existing || []).map(e => [e.concept_id, e.id]));
    const operations = rows.map(async (r) => {
      const existingId = existingByConcept.get(r.concept.id);
      const hasPriority = r.priority !== '';
      if (hasPriority && existingId) {
        return supabase.from('payment_hierarchy_configs').update({ priority_order: Number(r.priority) }).eq('id', existingId);
      }
      if (hasPriority) {
        return supabase.from('payment_hierarchy_configs').insert({
          organization_id: activeOrg.id,
          concept_id: r.concept.id,
          priority_order: Number(r.priority),
        });
      }
      if (existingId) {
        return supabase.from('payment_hierarchy_configs').delete().eq('id', existingId);
      }
      return null;
    });

    const results = await Promise.all(operations);
    const failed = results.some(res => res && res.error);

    setSaving(false);
    if (failed) {
      setSaveError('Algunos cambios no se pudieron guardar. Recargue la página e intente nuevamente.');
      await loadData();
      return;
    }
    setSaved(true);
    await loadData();
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Prelación de Pagos</h2>
          <p className="text-sm text-gray-500 mt-1">Defina el orden en que los pagos cubren los conceptos de cobro. Un número menor se paga primero.</p>
        </div>
        <Button onClick={handleSave} disabled={saving || loading}>
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : <><Save className="w-4 h-4" /> Guardar Prelación</>}
        </Button>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
        <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-800">Ejemplo: 1 para Intereses de Mora, 2 para Multas y 3 para Cuota Ordinaria. Los conceptos sin prioridad se dejan al final.</p>
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{loadError}</p>
        </div>
      )}
      {saveError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{saveError}</p>
        </div>
      )}
      {saved && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-700">La prelación de pagos se guardó correctamente.</p>
        </div>
      )}

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Layers className="w-8 h-8 text-gray-400" /></div>
            <p className="text-gray-500">No hay conceptos de cobro activos para ordenar</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 w-40">Prioridad</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Concepto</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Categoría</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {sortedRows.map(r => (
                  <tr key={r.concept.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={r.priority}
                        onChange={(e) => updatePriority(r.concept.id, e.target.value)}
                        placeholder="—"
                        aria-label={`Prioridad de ${r.concept.name}`}
                        className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </td>
                    <td className="px-6 py-3">
                      <p className="text-sm font-medium text-gray-900">{r.concept.name}</p>
                      <p className="text-xs font-mono text-gray-500">{r.concept.code}</p>
                      {r.concept.is_late_interest && <div className="mt-1"><Badge variant="yellow">Intereses de mora</Badge></div>}
                    </td>
                    <td className="px-6 py-3 hidden md:table-cell"><Badge variant="gray">{billingCategoryLabels[r.concept.category]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
