import { useEffect, useState, useCallback } from 'react';
import { Calendar, Plus, Pencil, Trash2, Loader2, CalendarDays, AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import { supabase, RevenuePeriod } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatShortDate, revenueFrequencyLabels } from '@/lib/format';

const MONTHS = [
  { value: 1, label: 'Enero' },
  { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' },
  { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' },
];

function monthLabel(m: number | null): string {
  if (m == null) return '—';
  return MONTHS.find(x => x.value === m)?.label ?? String(m);
}

interface FormState {
  name: string;
  frequency: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  work_month: string;
  work_year: string;
  is_work_period_active: boolean;
}

const emptyForm: FormState = {
  name: '', frequency: 'mensual', start_date: '', end_date: '',
  is_active: true,
  work_month: '9', work_year: '2026', is_work_period_active: false,
};

export default function CalendarioPage() {
  const { activeOrg } = useOrg();
  const [items, setItems] = useState<RevenuePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RevenuePeriod | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<RevenuePeriod | null>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => { if (activeOrg) loadItems(); }, [activeOrg]);

  const activeWorkPeriod = items.find(p => p.is_work_period_active) ?? null;

  const loadItems = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from('revenue_periods')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .order('start_date', { ascending: false });
    setItems(data || []);
    setLoading(false);
  }, [activeOrg]);

  // Calcula automáticamente fechas y nombre según el mes seleccionado sin alterar manualmente el año fiscal
  function updatePeriodDatesAndName(monthStr: string, yearStr: string, currentForm: FormState) {
    const m = parseInt(monthStr);
    const y = parseInt(yearStr);
    let updated = { ...currentForm, work_month: monthStr, work_year: yearStr };

    if (!isNaN(m) && !isNaN(y) && y > 1900) {
      const monthName = MONTHS.find(x => x.value === m)?.label ?? '';
      const formattedMonth = String(m).padStart(2, '0');
      const startDate = `${y}-${formattedMonth}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const endDate = `${y}-${formattedMonth}-${String(lastDay).padStart(2, '0')}`;

      updated.name = `${monthName} ${y}`;
      updated.start_date = startDate;
      updated.end_date = endDate;
    }
    return updated;
  }

  function openCreate() {
    setEditing(null);
    
    // Calcula el mes y año consecutivo basándose únicamente en la secuencia del último periodo existente
    let nextMonth = 1;
    let nextYear = 2026;

    if (items.length > 0) {
      const latest = items[0];
      if (latest.work_month != null && latest.work_year != null) {
        if (latest.work_month === 12) {
          nextMonth = 1;
          nextYear = latest.work_year + 1; // Transición automática al siguiente año fiscal al cruzar Diciembre -> Enero
        } else {
          nextMonth = latest.work_month + 1; // Siguiente mes consecutivo
          nextYear = latest.work_year;       // Hereda el año fiscal de trabajo actual
        }
      }
    }

    const initialForm = updatePeriodDatesAndName(String(nextMonth), String(nextYear), emptyForm);
    setForm(initialForm);
    setError('');
    setModalOpen(true);
  }

  function openEdit(p: RevenuePeriod) {
    setEditing(p);
    setForm({
      name: p.name,
      frequency: p.frequency,
      start_date: p.start_date,
      end_date: p.end_date,
      is_active: p.is_active,
      work_month: p.work_month != null ? String(p.work_month) : '',
      work_year: p.work_year != null ? String(p.work_year) : '',
      is_work_period_active: p.is_work_period_active,
    });
    setError('');
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    if (!activeOrg) return;

    if (!form.name.trim()) {
      setError('El nombre del periodo es obligatorio.');
      setSaving(false);
      return;
    }
    if (!form.start_date || !form.end_date) {
      setError('Las fechas de inicio y fin son obligatorias.');
      setSaving(false);
      return;
    }

    const workMonthVal = form.work_month ? parseInt(form.work_month) : null;
    const workYearVal = form.work_year ? parseInt(form.work_year) : null;

    if (form.is_work_period_active && (workMonthVal == null || workYearVal == null)) {
      setError('Para activar el periodo de trabajo debe seleccionar mes y año.');
      setSaving(false);
      return;
    }

    const payload = {
      organization_id: activeOrg.id,
      name: form.name,
      frequency: form.frequency,
      start_date: form.start_date,
      end_date: form.end_date,
      billing_day: 1,
      due_day: 5,
      grace_days: 0,
      offset_days: 0,
      late_interest_rate: 0,
      discount_threshold_days: 0,
      discount_rate: 0,
      is_active: form.is_active,
      work_month: workMonthVal,
      work_year: workYearVal,
      is_work_period_active: form.is_work_period_active,
    };

    try {
      if (form.is_work_period_active) {
        await supabase
          .from('revenue_periods')
          .update({ is_work_period_active: false })
          .eq('organization_id', activeOrg.id)
          .neq('id', editing?.id ?? '00000000-0000-0000-0000-000000000000');
      }

      if (editing) {
        const { error: err } = await supabase.from('revenue_periods').update(payload).eq('id', editing.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from('revenue_periods').insert(payload);
        if (err) throw err;
      }
      setSaving(false);
      setModalOpen(false);
      await loadItems();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar el periodo';
      setError(msg);
      setSaving(false);
    }
  }

  async function handleActivateWorkPeriod(p: RevenuePeriod) {
    if (!activeOrg || p.is_work_period_active) return;
    if (p.work_month == null || p.work_year == null) {
      setError('Este periodo no tiene mes/año de trabajo definidos. Edítelo primero.');
      return;
    }
    setActivating(true);
    try {
      await supabase
        .from('revenue_periods')
        .update({ is_work_period_active: false })
        .eq('organization_id', activeOrg.id)
        .neq('id', p.id);
      const { error: err } = await supabase
        .from('revenue_periods')
        .update({ is_work_period_active: true })
        .eq('id', p.id);
      if (err) throw err;
      await loadItems();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al activar el periodo de trabajo';
      setError(msg);
    }
    setActivating(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await supabase.from('revenue_periods').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null);
    await loadItems();
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calendario de Recaudo</h1>
          <p className="text-gray-500 mt-1">Parametrización del periodo de trabajo activo de cartera</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> Nuevo Periodo</Button>
      </div>

      {activeWorkPeriod ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 mb-6 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-900">
              Periodo de trabajo activo: {activeWorkPeriod.name} — {monthLabel(activeWorkPeriod.work_month)} {activeWorkPeriod.work_year}
            </p>
            <p className="text-xs text-emerald-700 mt-1">
              Todas las transacciones de cartera (facturación, recaudos, acuerdos) se registran únicamente para este periodo. No es posible registrar movimientos para un periodo diferente al activo.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 mb-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-900">No hay un periodo de trabajo activo</p>
            <p className="text-xs text-amber-700 mt-1">
              Active un periodo de trabajo para habilitar el registro de transacciones de cartera. Mientras no haya un periodo activo, no se podrá facturar ni registrar recaudos.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 mb-6 flex items-start gap-2">
        <Lock className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
        <p className="text-xs text-gray-600">
          <strong>Restricción de periodo:</strong> El sistema bloquea cualquier intento de registrar una transacción de cartera correspondiente a un periodo distinto al periodo de trabajo activo. Solo puede haber un periodo activo por organización a la vez.
        </p>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Calendar className="w-8 h-8 text-gray-400" /></div>
            <p className="text-gray-500">No hay periodos configurados</p>
            <p className="text-sm text-gray-400 mt-1">Cree un calendario de recaudo y active el periodo de trabajo para empezar a generar cuotas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Periodo</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Frecuencia</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Periodo Trabajo</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Acciones</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-500">{formatShortDate(p.start_date)} — {formatShortDate(p.end_date)}</p>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell"><Badge variant="blue">{revenueFrequencyLabels[p.frequency]}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm text-gray-900">{monthLabel(p.work_month)} {p.work_year ?? '—'}</span>
                        {p.is_work_period_active ? (
                          <Badge variant="green">Activo</Badge>
                        ) : (
                          <button
                            onClick={() => handleActivateWorkPeriod(p)}
                            disabled={activating || p.work_month == null || p.work_year == null}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-400 disabled:cursor-not-allowed"
                            title={p.work_month == null ? 'Defina mes y año antes de activar' : 'Activar como periodo de trabajo'}
                          >
                            Activar
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4"><Badge variant={p.is_active ? 'green' : 'gray'}>{p.is_active ? 'Activo' : 'Inactivo'}</Badge></td>
                    <td className="px-6 py-4"><div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(p)} className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setDeleteTarget(p)} className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Periodo' : 'Nuevo Periodo de Trabajo'} size="md">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Formulario limpio sin la sección ni subtítulos redundantes de "Datos del Periodo" */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Periodo de Trabajo (Secuencia Consecutiva)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select 
                label="Mes Siguiente Consecutivo *" 
                value={form.work_month} 
                onChange={(e) => setForm(updatePeriodDatesAndName(e.target.value, form.work_year, form))}
              >
                {MONTHS.map(m => <option key={m.value} value={String(m.value)}>{m.label}</option>)}
              </Select>

              {/* El año fiscal se hereda automáticamente y queda bloqueado para edición manual */}
              <Input 
                label="Año Fiscal de Trabajo (Protegido)" 
                type="number" 
                value={form.work_year} 
                disabled
                className="bg-gray-100 text-gray-600 cursor-not-allowed font-semibold"
              />
            </div>

            <p className="text-xs text-gray-500 mt-2">
              El sistema mantiene en orden la secuencia mensual. Si se pasa de Diciembre a Enero, el año fiscal se incrementa automáticamente.
            </p>

            <label className="flex items-center gap-2 cursor-pointer mt-4 rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50">
              <input
                type="checkbox"
                checked={form.is_work_period_active}
                onChange={(e) => setForm({ ...form, is_work_period_active: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-900">Activar como periodo de trabajo actual</span>
                <p className="text-xs text-gray-500">Solo puede haber un periodo activo a la vez. Al activarlo, los demás se desactivan automáticamente.</p>
              </div>
            </label>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700">Periodo disponible (activo)</span>
          </label>

          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar Periodo" size="sm">
        <p className="text-sm text-gray-600 mb-4">
          ¿Eliminar el periodo <strong>{deleteTarget?.name}</strong>?
          {deleteTarget?.is_work_period_active && (
            <span className="block mt-2 text-amber-600">Este es el periodo de trabajo activo. Al eliminarlo, no habrá periodo activo hasta que active otro.</span>
          )}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Sí, Eliminar</Button>
        </div>
      </Modal>
    </div>
  );
}