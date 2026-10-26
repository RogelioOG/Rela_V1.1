import { useEffect, useState } from 'react';
import { ClipboardList, Plus, Pencil, Trash2, Search, Loader2 } from 'lucide-react';
import { supabase, ThirdParty } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { thirdPartyTypeLabels, documentTypeLabels } from '@/lib/format';

interface FormState {
  type: string;
  name: string;
  document_type: string;
  document_number: string;
  address: string;
  phone: string;
  email: string;
  city: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  type: 'cliente', name: '', document_type: 'nit', document_number: '',
  address: '', phone: '', email: '', city: '', is_active: true,
};

export default function TercerosPage() {
  const { activeOrg } = useOrg();
  const [items, setItems] = useState<ThirdParty[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ThirdParty | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ThirdParty | null>(null);

  useEffect(() => {
    if (activeOrg) loadItems();
  }, [activeOrg]);

  async function loadItems() {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from('third_parties')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .order('name', { ascending: true });
    setItems(data || []);
    setLoading(false);
  }

  const filtered = items.filter((t) => {
    const ms = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.document_number.includes(search);
    const mt = !filterType || t.type === filterType;
    return ms && mt;
  });

  function openCreate() { setEditing(null); setForm(emptyForm); setError(''); setModalOpen(true); }
  function openEdit(t: ThirdParty) {
    setEditing(t);
    setForm({ type: t.type, name: t.name, document_type: t.document_type, document_number: t.document_number,
      address: t.address, phone: t.phone, email: t.email, city: t.city, is_active: t.is_active });
    setError(''); setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    if (!activeOrg) return;
    const payload = { ...form, organization_id: activeOrg.id };
    if (editing) {
      const { error: err } = await supabase.from('third_parties').update(payload).eq('id', editing.id);
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      const { error: err } = await supabase.from('third_parties').insert(payload);
      if (err) { setError(err.message); setSaving(false); return; }
    }
    setSaving(false); setModalOpen(false); await loadItems();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await supabase.from('third_parties').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null); await loadItems();
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Terceros</h1>
          <p className="text-gray-500 mt-1">Clientes y Proveedores</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> Nuevo Tercero</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar por nombre o documento..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos</option>
          <option value="cliente">Clientes</option>
          <option value="proveedor">Proveedores</option>
        </select>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4">
              <ClipboardList className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-gray-500">No se encontraron terceros</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Nombre</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Tipo</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Documento</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Teléfono</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Ciudad</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-500">{t.email || 'Sin correo'}</p>
                    </td>
                    <td className="px-6 py-4"><Badge variant={t.type === 'cliente' ? 'blue' : 'green'}>{thirdPartyTypeLabels[t.type]}</Badge></td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden md:table-cell">{documentTypeLabels[t.document_type]}: {t.document_number || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden lg:table-cell">{t.phone || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden lg:table-cell">{t.city || 'N/A'}</td>
                    <td className="px-6 py-4"><Badge variant={t.is_active ? 'green' : 'gray'}>{t.is_active ? 'Activo' : 'Inactivo'}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(t)} className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setDeleteTarget(t)} className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Tercero' : 'Nuevo Tercero'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Tipo" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="cliente">Cliente</option>
              <option value="proveedor">Proveedor</option>
            </Select>
            <Input label="Nombre / Razón Social *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Select label="Tipo de Documento" value={form.document_type} onChange={(e) => setForm({ ...form, document_type: e.target.value })}>
              <option value="nit">NIT</option>
              <option value="cedula">Cédula</option>
            </Select>
            <Input label="Número de Documento" value={form.document_number} onChange={(e) => setForm({ ...form, document_number: e.target.value })} placeholder="Ej: 900.123.456-7" />
            <Input label="Dirección" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <Input label="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label="Correo Electrónico" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input label="Ciudad" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700">Tercero activo</span>
          </label>
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar Tercero" size="sm">
        <p className="text-sm text-gray-600 mb-4">¿Eliminar a <strong>{deleteTarget?.name}</strong>?</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Sí, Eliminar</Button>
        </div>
      </Modal>
    </div>
  );
}
