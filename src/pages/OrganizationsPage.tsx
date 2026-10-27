import { useEffect, useState } from 'react';
import { Building2, Plus, Pencil, Trash2, Search, Store, Home, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, Organization } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { organizationTypes, formatDateTime } from '@/lib/format';

interface FormState {
  name: string;
  type: string;
  nit: string;
  address: string;
  phone: string;
  email: string;
  city: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  name: '',
  type: 'tienda',
  nit: '',
  address: '',
  phone: '',
  email: '',
  city: '',
  is_active: true,
};

export default function OrganizationsPage() {
  const { profile } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null);

  const isMaster = profile?.role === 'master';

  useEffect(() => {
    loadOrgs();
  }, []);

  async function loadOrgs() {
    setLoading(true);
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Error loading organizations:', error);
    } else {
      setOrgs(data || []);
    }
    setLoading(false);
  }

  const filtered = orgs.filter((org) => {
    const matchesSearch = !search ||
      org.name.toLowerCase().includes(search.toLowerCase()) ||
      (org.nit || '').includes(search) ||
      org.city.toLowerCase().includes(search.toLowerCase());
    const matchesType = !filterType || org.type === filterType;
    return matchesSearch && matchesType;
  });

  function openCreate() {
    setEditingOrg(null);
    setForm(emptyForm);
    setError('');
    setModalOpen(true);
  }

  function openEdit(org: Organization) {
    setEditingOrg(org);
    setForm({
      name: org.name,
      type: org.type,
      nit: org.nit || '',
      address: org.address,
      phone: org.phone,
      email: org.email,
      city: org.city,
      is_active: org.is_active,
    });
    setError('');
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const payload = {
      name: form.name,
      type: form.type,
      nit: form.nit || null,
      address: form.address,
      phone: form.phone,
      email: form.email,
      city: form.city,
      is_active: form.is_active,
    };

    if (editingOrg) {
      const { error: updateError } = await supabase
        .from('organizations')
        .update(payload)
        .eq('id', editingOrg.id);
      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from('organizations')
        .insert(payload);
      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setModalOpen(false);
    await loadOrgs();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase
      .from('organizations')
      .delete()
      .eq('id', deleteTarget.id);
    if (error) {
      setError(error.message);
    } else {
      setDeleteTarget(null);
      await loadOrgs();
    }
  }

  if (!isMaster) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardBody className="text-center py-12">
            <p className="text-gray-500">No tiene permisos para acceder a esta sección.</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Organizaciones</h1>
          <p className="text-gray-500 mt-1">Gestione los negocios y propiedades residenciales</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4" />
          Nueva Organización
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nombre, NIT o ciudad..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(organizationTypes).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4">
              <Building2 className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-gray-500">No se encontraron organizaciones</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-6 py-3">Nombre</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-6 py-3">Tipo</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-6 py-3 hidden md:table-cell">NIT</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-6 py-3 hidden lg:table-cell">Ciudad</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-6 py-3">Estado</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-6 py-3 hidden xl:table-cell">Creada</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase tracking-wider px-6 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((org) => (
                  <tr key={org.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-100">
                          {org.type === 'residencial' ? <Home className="w-4 h-4 text-gray-600" /> : <Store className="w-4 h-4 text-gray-600" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{org.name}</p>
                          <p className="text-xs text-gray-500">{org.email || 'Sin correo'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="blue">{organizationTypes[org.type]}</Badge>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden md:table-cell">{org.nit || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden lg:table-cell">{org.city || 'N/A'}</td>
                    <td className="px-6 py-4">
                      <Badge variant={org.is_active ? 'green' : 'gray'}>
                        {org.is_active ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 hidden xl:table-cell">{formatDateTime(org.created_at)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(org)}
                          className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(org)}
                          className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingOrg ? 'Editar Organización' : 'Nueva Organización'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Nombre *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="Nombre de la organización"
            />
            <Select
              label="Tipo *"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {Object.entries(organizationTypes).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <Input
              label="NIT"
              value={form.nit}
              onChange={(e) => setForm({ ...form, nit: e.target.value })}
              placeholder="Ej: 900.123.456-7"
            />
            <Input
              label="Ciudad"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="Ej: Bogotá"
            />
            <Input
              label="Dirección"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Dirección"
            />
            <Input
              label="Teléfono"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Ej: +57 300 123 4567"
            />
            <Input
              label="Correo Electrónico"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="correo@organizacion.com"
            />
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Organización activa</span>
              </label>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </>
              ) : editingOrg ? 'Guardar Cambios' : 'Crear Organización'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Eliminar Organización"
        size="sm"
      >
        <div>
          <p className="text-sm text-gray-600 mb-4">
            ¿Está seguro de eliminar la organización <strong>{deleteTarget?.name}</strong>?
            Esta acción no se puede deshacer y eliminará todas las asociaciones de usuarios vinculadas.
          </p>
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 mb-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Sí, Eliminar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
