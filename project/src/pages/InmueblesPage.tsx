import { useEffect, useState } from 'react';
import { Home, Plus, Pencil, Trash2, Search, Loader2 } from 'lucide-react';
import { supabase, Unit } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { unitTypeLabels, formatNumber } from '@/lib/format';

interface FormState {
  tower: string; unit_label: string; type: string; coefficient: string;
  owner_name: string; owner_document: string; owner_phone: string; is_active: boolean;
}
const emptyForm: FormState = { tower: '', unit_label: '', type: 'apartamento', coefficient: '0', owner_name: '', owner_document: '', owner_phone: '', is_active: true };

export default function InmueblesPage() {
  const { activeOrg } = useOrg();
  const [items, setItems] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Unit | null>(null);

  useEffect(() => { if (activeOrg) loadItems(); }, [activeOrg]);

  async function loadItems() {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase.from('units').select('*').eq('organization_id', activeOrg.id).order('tower', { ascending: true }).order('unit_label', { ascending: true });
    setItems(data || []);
    setLoading(false);
  }

  const filtered = items.filter(u => !search || u.unit_label.toLowerCase().includes(search.toLowerCase()) || u.tower.toLowerCase().includes(search.toLowerCase()) || u.owner_name.toLowerCase().includes(search.toLowerCase()));

  function openCreate() { setEditing(null); setForm(emptyForm); setError(''); setModalOpen(true); }
  function openEdit(u: Unit) {
    setEditing(u);
    setForm({ tower: u.tower, unit_label: u.unit_label, type: u.type, coefficient: String(u.coefficient), owner_name: u.owner_name, owner_document: u.owner_document, owner_phone: u.owner_phone, is_active: u.is_active });
    setError(''); setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    if (!activeOrg) return;
    const payload = { ...form, coefficient: parseFloat(form.coefficient) || 0, organization_id: activeOrg.id };
    if (editing) {
      const { error: err } = await supabase.from('units').update(payload).eq('id', editing.id);
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      const { error: err } = await supabase.from('units').insert(payload);
      if (err) { setError(err.message); setSaving(false); return; }
    }
    setSaving(false); setModalOpen(false); await loadItems();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await supabase.from('units').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null); await loadItems();
  }

  if (!activeOrg) return <NoOrgSelected />;

  const totalCoeff = items.reduce((s, u) => s + u.coefficient, 0);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inmuebles / Unidades</h1>
          <p className="text-gray-500 mt-1">Unidades privadas de propiedad horizontal</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> Nueva Unidad</Button>
      </div>

      {items.length > 0 && (
        <div className="mb-4 flex gap-4">
          <div className="px-4 py-2 rounded-lg bg-gray-100 text-sm text-gray-700">Total unidades: <strong>{items.length}</strong></div>
          <div className="px-4 py-2 rounded-lg bg-gray-100 text-sm text-gray-700">Suma coeficientes: <strong>{formatNumber(totalCoeff, 4)}</strong></div>
        </div>
      )}

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" placeholder="Buscar por torre, unidad o propietario..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16"><div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Home className="w-8 h-8 text-gray-400" /></div><p className="text-gray-500">No se encontraron unidades</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Unidad</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Tipo</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Coeficiente</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Propietario</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Teléfono</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Acciones</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">{u.unit_label}</p>
                      <p className="text-xs text-gray-500">Torre: {u.tower || 'N/A'}</p>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell"><Badge variant="blue">{unitTypeLabels[u.type]}</Badge></td>
                    <td className="px-6 py-4 text-right text-sm text-gray-700">{formatNumber(u.coefficient, 4)}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden lg:table-cell">{u.owner_name || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden lg:table-cell">{u.owner_phone || 'N/A'}</td>
                    <td className="px-6 py-4"><Badge variant={u.is_active ? 'green' : 'gray'}>{u.is_active ? 'Activa' : 'Inactiva'}</Badge></td>
                    <td className="px-6 py-4"><div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(u)} className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setDeleteTarget(u)} className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Unidad' : 'Nueva Unidad'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Torre / Bloque" value={form.tower} onChange={(e) => setForm({ ...form, tower: e.target.value })} placeholder="Ej: Torre 1" />
            <Input label="Identificación de Unidad *" value={form.unit_label} onChange={(e) => setForm({ ...form, unit_label: e.target.value })} required placeholder="Ej: Apto 101" />
            <Select label="Tipo" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {Object.entries(unitTypeLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Input label="Coeficiente de Copropiedad" type="number" step="0.0001" value={form.coefficient} onChange={(e) => setForm({ ...form, coefficient: e.target.value })} placeholder="Ej: 0.0250" />
            <Input label="Propietario" value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} />
            <Input label="Documento del Propietario" value={form.owner_document} onChange={(e) => setForm({ ...form, owner_document: e.target.value })} placeholder="Cédula o NIT" />
            <Input label="Teléfono del Propietario" value={form.owner_phone} onChange={(e) => setForm({ ...form, owner_phone: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700">Unidad activa</span>
          </label>
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar Unidad" size="sm">
        <p className="text-sm text-gray-600 mb-4">¿Eliminar la unidad <strong>{deleteTarget?.unit_label}</strong>? Se eliminarán también las cuotas asociadas.</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Sí, Eliminar</Button>
        </div>
      </Modal>
    </div>
  );
}
