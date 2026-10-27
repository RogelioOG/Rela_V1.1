import { useEffect, useState, useCallback } from 'react';
import { Calendar, Plus, Pencil, Trash2, Loader2, Clock, Percent, CalendarDays } from 'lucide-react';
import { supabase, RevenuePeriod } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatShortDate, revenueFrequencyLabels } from '@/lib/format';

interface FormState {
  name: string;
  frequency: string;
  start_date: string;
  end_date: string;
  billing_day: string;
  due_day: string;
  grace_days: string;
  offset_days: string;
  interest_start_date: string;
  late_interest_rate: string;
  discount_threshold_days: string;
  discount_rate: string;
  is_active: boolean;
}
const emptyForm: FormState = {
  name: '', frequency: 'mensual', start_date: '', end_date: '',
  billing_day: '1', due_day: '5', grace_days: '0', offset_days: '0',
  interest_start_date: '', late_interest_rate: '0', discount_threshold_days: '0',
  discount_rate: '0', is_active: true,
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

  useEffect(() => { if (activeOrg) loadItems(); }, [activeOrg]);

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

  function openCreate() {
    setEditing(null);
    const now = new Date();
    const year = now.getFullYear();
    setForm({
      ...emptyForm,
      name: `Recaudo ${year}`,
      start_date: `${year}-01-01`,
      end_date: `${year}-12-31`,
    });
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
      billing_day: String(p.billing_day),
      due_day: String(p.due_day),
      grace_days: String(p.grace_days),
      offset_days: String(p.offset_days),
      interest_start_date: p.interest_start_date || '',
      late_interest_rate: String(p.late_interest_rate),
      discount_threshold_days: String(p.discount_threshold_days),
      discount_rate: String(p.discount_rate),
      is_active: p.is_active,
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

    const payload = {
      organization_id: activeOrg.id,
      name: form.name,
      frequency: form.frequency,
      start_date: form.start_date,
      end_date: form.end_date,
      billing_day: parseInt(form.billing_day) || 1,
      due_day: parseInt(form.due_day) || 5,
      grace_days: parseInt(form.grace_days) || 0,
      offset_days: parseInt(form.offset_days) || 0,
      interest_start_date: form.interest_start_date || null,
      late_interest_rate: parseFloat(form.late_interest_rate) || 0,
      discount_threshold_days: parseInt(form.discount_threshold_days) || 0,
      discount_rate: parseFloat(form.discount_rate) || 0,
      is_active: form.is_active,
    };

    try {
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
          <p className="text-gray-500 mt-1">Configuración de periodos de facturación, gracia, intereses y descuentos</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> Nuevo Periodo</Button>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Calendar className="w-8 h-8 text-gray-400" /></div>
            <p className="text-gray-500">No hay periodos configurados</p>
            <p className="text-sm text-gray-400 mt-1">Cree un calendario de recaudo para empezar a generar cuotas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Periodo</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Frecuencia</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Facturación / Vencimiento</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Gracia / Desfase</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Interés Mora</th>
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
                    <td className="px-6 py-4 text-sm text-gray-700 hidden lg:table-cell">
                      <p>Día facturación: <strong>{p.billing_day}</strong></p>
                      <p>Vencimiento: <strong>{p.due_day}</strong></p>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden lg:table-cell">
                      <p>Gracia: {p.grace_days} días</p>
                      <p>Desfase: {p.offset_days} días</p>
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-gray-700 hidden lg:table-cell">
                      {p.late_interest_rate > 0 ? `${(p.late_interest_rate * 100).toFixed(2)}%` : 'N/A'}
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Periodo' : 'Nuevo Periodo'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Datos del Periodo</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Nombre del Periodo *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Ej: Recaudo 2026" />
              <Select label="Frecuencia" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                {Object.entries(revenueFrequencyLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Input label="Fecha de Inicio *" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
              <Input label="Fecha de Fin *" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} required />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Clock className="w-4 h-4" /> Días de Facturación y Vencimiento</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Día de Facturación (1-31)" type="number" min="1" max="31" value={form.billing_day} onChange={(e) => setForm({ ...form, billing_day: e.target.value })} />
              <Input label="Día de Vencimiento (1-31)" type="number" min="1" max="31" value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} />
              <Input label="Días de Gracia" type="number" min="0" value={form.grace_days} onChange={(e) => setForm({ ...form, grace_days: e.target.value })} />
              <Input label="Días de Desfase" type="number" min="0" value={form.offset_days} onChange={(e) => setForm({ ...form, offset_days: e.target.value })} />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Percent className="w-4 h-4" /> Intereses de Mora y Descuentos</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Fecha Inicio Intereses de Mora" type="date" value={form.interest_start_date} onChange={(e) => setForm({ ...form, interest_start_date: e.target.value })} />
              <Input label="Tasa de Interés de Mora (mensual)" type="number" step="0.01" value={form.late_interest_rate} onChange={(e) => setForm({ ...form, late_interest_rate: e.target.value })} placeholder="Ej: 1.5 (equivalente a 0.015)" />
              <Input label="Días Umbral Descuento (pago anticipado)" type="number" min="0" value={form.discount_threshold_days} onChange={(e) => setForm({ ...form, discount_threshold_days: e.target.value })} />
              <Input label="Tasa de Descuento" type="number" step="0.01" value={form.discount_rate} onChange={(e) => setForm({ ...form, discount_rate: e.target.value })} placeholder="Ej: 5 (equivalente a 0.05)" />
            </div>
            <p className="text-xs text-gray-400 mt-2">Las tasas se ingresan como porcentaje. Ej: 1.5 = 1.5% mensual.</p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700">Periodo activo</span>
          </label>

          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar Periodo" size="sm">
        <p className="text-sm text-gray-600 mb-4">¿Eliminar el periodo <strong>{deleteTarget?.name}</strong>?</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Sí, Eliminar</Button>
        </div>
      </Modal>
    </div>
  );
}
