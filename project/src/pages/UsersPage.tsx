import { useEffect, useState } from 'react';
import { Users, Plus, Pencil, Trash2, Search, Loader2, Link2, X, UserPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrganizationContext';
import { supabase, Profile, Organization } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { roleLabels, orgRoleLabels, formatDateTime } from '@/lib/format';

interface UserOrgInfo { id: string; name: string; role: string; }

export default function UsersPage() {
  const { profile: currentProfile } = useAuth();
  const { activeOrg, isOrgAdmin } = useOrg();
  const [users, setUsers] = useState<Profile[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [form, setForm] = useState({ full_name: '', email: '', role: 'user', is_active: true, password: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({ user_id: '', organization_id: '', role: 'user' });
  const [assignError, setAssignError] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [userOrgs, setUserOrgs] = useState<Record<string, UserOrgInfo[]>>({});

  const isMaster = currentProfile?.role === 'master';

  useEffect(() => { loadData(); }, [activeOrg, isMaster]);

  async function loadData() {
    setLoading(true);

    if (isMaster) {
      // Master: load all profiles and all orgs
      const [{ data: usersData }, { data: orgsData }, { data: uoData }] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('organizations').select('*').order('name', { ascending: true }),
        supabase.from('user_organizations').select('user_id, organization_id, role, organizations(id, name)').order('created_at', { ascending: false }),
      ]);
      setUsers(usersData || []);
      setOrgs(orgsData || []);
      const uoMap: Record<string, UserOrgInfo[]> = {};
      (uoData || []).forEach((uo: any) => {
        if (!uoMap[uo.user_id]) uoMap[uo.user_id] = [];
        if (uo.organizations) uoMap[uo.user_id].push({ id: uo.organizations.id, name: uo.organizations.name, role: uo.role });
      });
      setUserOrgs(uoMap);
    } else if (activeOrg && isOrgAdmin) {
      // Org admin: load only users assigned to this org
      const { data: uoData } = await supabase
        .from('user_organizations')
        .select('profiles(*), role, organizations(id, name)')
        .eq('organization_id', activeOrg.id)
        .order('created_at', { ascending: false });

      const orgUsers: Profile[] = [];
      const uoMap: Record<string, UserOrgInfo[]> = {};
      (uoData || []).forEach((uo: any) => {
        if (uo.profiles) {
          orgUsers.push(uo.profiles as Profile);
          if (!uoMap[uo.profiles.id]) uoMap[uo.profiles.id] = [];
          uoMap[uo.profiles.id].push({ id: uo.organizations?.id || '', name: uo.organizations?.name || '', role: uo.role });
        }
      });
      setUsers(orgUsers);
      setUserOrgs(uoMap);
      setOrgs([]);
    }

    setLoading(false);
  }

  const filtered = users.filter((u) => {
    const matchesSearch = !search ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.full_name.toLowerCase().includes(search.toLowerCase());
    let matchesRole = true;
    if (filterRole) {
      if (isMaster) {
        matchesRole = u.role === filterRole;
      } else {
        const orgRole = (userOrgs[u.id] || []).find(o => o.id === activeOrg?.id)?.role;
        matchesRole = orgRole === filterRole;
      }
    }
    return matchesSearch && matchesRole;
  });

  function openCreate() {
    setEditingUser(null);
    setForm({ full_name: '', email: '', role: 'user', is_active: true, password: '' });
    setError('');
    setModalOpen(true);
  }

  function openEdit(user: Profile) {
    setEditingUser(user);
    setForm({ full_name: user.full_name, email: user.email, role: user.role, is_active: user.is_active, password: '' });
    setError('');
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    if (editingUser) {
      if (isMaster) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ full_name: form.full_name, role: form.role, is_active: form.is_active })
          .eq('id', editingUser.id);
        if (updateError) { setError(updateError.message); setSaving(false); return; }
      } else if (activeOrg) {
        // Org admin can only update name and active status, not global role
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ full_name: form.full_name, is_active: form.is_active })
          .eq('id', editingUser.id);
        if (updateError) { setError(updateError.message); setSaving(false); return; }
        // Update org role
        const { error: uoError } = await supabase
          .from('user_organizations')
          .update({ role: form.role === 'admin' ? 'admin' : 'user' })
          .eq('user_id', editingUser.id)
          .eq('organization_id', activeOrg.id);
        if (uoError) { setError(uoError.message); setSaving(false); return; }
      }
    } else {
      // Create new user
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('No hay sesión activa'); setSaving(false); return; }
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email, full_name: form.full_name,
          role: isMaster ? form.role : 'user',
          is_active: form.is_active, password: form.password || undefined,
          organization_id: isMaster ? undefined : activeOrg?.id,
          org_role: isMaster ? undefined : (form.role === 'admin' ? 'admin' : 'user'),
        }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || `Error al crear usuario (${response.status})`);
        setSaving(false); return;
      }
    }

    setSaving(false);
    setModalOpen(false);
    await loadData();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.role === 'master') { setError('No se puede eliminar el usuario Super Administrador'); return; }

    if (!isMaster && activeOrg) {
      // Org admin: remove user from org, not delete the profile
      const { error } = await supabase
        .from('user_organizations')
        .delete()
        .eq('user_id', deleteTarget.id)
        .eq('organization_id', activeOrg.id);
      if (error) { setError(error.message); return; }
    } else {
      const { error } = await supabase.from('profiles').delete().eq('id', deleteTarget.id);
      if (error) { setError(error.message); return; }
    }
    setDeleteTarget(null);
    await loadData();
  }

  function openAssign(userId: string) {
    setAssignForm({ user_id: userId, organization_id: '', role: 'user' });
    setAssignError('');
    setAssignModalOpen(true);
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    setAssignSaving(true);
    setAssignError('');
    const { error } = await supabase
      .from('user_organizations')
      .insert({ user_id: assignForm.user_id, organization_id: assignForm.organization_id, role: assignForm.role });
    if (error) {
      setAssignError(error.code === '23505' ? 'Este usuario ya está asignado a esta organización' : error.message);
      setAssignSaving(false); return;
    }
    setAssignSaving(false);
    setAssignModalOpen(false);
    await loadData();
  }

  async function removeAssignment(userId: string, orgId: string) {
    const { error } = await supabase
      .from('user_organizations')
      .delete()
      .eq('user_id', userId)
      .eq('organization_id', orgId);
    if (error) { console.error('Error removing assignment:', error); }
    else { await loadData(); }
  }

  if (!isMaster && !isOrgAdmin) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card><CardBody className="text-center py-12">
          <p className="text-gray-500">No tiene permisos para acceder a esta sección.</p>
        </CardBody></Card>
      </div>
    );
  }

  const pageTitle = isMaster ? 'Usuarios del Sistema' : 'Usuarios de la Organización';
  const pageSubtitle = isMaster
    ? 'Gestione los usuarios globales de la plataforma'
    : `Gestione los usuarios de ${activeOrg?.name || 'la organización'}`;
  const roleOptions = isMaster
    ? [{ value: 'user', label: 'Colaborador' }, { value: 'admin', label: 'Administrador' }, { value: 'master', label: 'Super Administrador' }]
    : [{ value: 'user', label: 'Colaborador' }, { value: 'admin', label: 'Administrador de Organización' }];

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{pageTitle}</h1>
          <p className="text-gray-500 mt-1">{pageSubtitle}</p>
        </div>
        <Button onClick={openCreate}><UserPlus className="w-4 h-4" /> Nuevo Usuario</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar por nombre o correo..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos los roles</option>
          {roleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Users className="w-8 h-8 text-gray-400" /></div>
            <p className="text-gray-500">No se encontraron usuarios</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Usuario</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Rol</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                  {isMaster && <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Organizaciones</th>}
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden xl:table-cell">Creado</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((user) => {
                  const userOrgList = userOrgs[user.id] || [];
                  const orgRole = !isMaster && activeOrg ? userOrgList.find(o => o.id === activeOrg.id)?.role : null;
                  return (
                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white text-sm font-semibold">
                            {user.full_name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{user.full_name || 'Sin nombre'}</p>
                            <p className="text-xs text-gray-500">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {isMaster ? (
                          <Badge variant={user.role === 'master' ? 'purple' : user.role === 'admin' ? 'blue' : 'gray'}>
                            {roleLabels[user.role]}
                          </Badge>
                        ) : (
                          <Badge variant={orgRole === 'admin' ? 'blue' : 'gray'}>
                            {orgRole ? orgRoleLabels[orgRole] : 'N/A'}
                          </Badge>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={user.is_active ? 'green' : 'red'}>{user.is_active ? 'Activo' : 'Inactivo'}</Badge>
                      </td>
                      {isMaster && <td className="px-6 py-4 hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {userOrgList.map((org) => (
                            <span key={org.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-xs text-gray-700">
                              {org.name}
                              {user.role !== 'master' && (
                                <button onClick={() => removeAssignment(user.id, org.id)} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                              )}
                            </span>
                          ))}
                          {userOrgList.length === 0 && <span className="text-xs text-gray-400">Sin asignaciones</span>}
                        </div>
                      </td>}
                      <td className="px-6 py-4 text-sm text-gray-500 hidden xl:table-cell">{formatDateTime(user.created_at)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {isMaster && user.role !== 'master' && (
                            <button onClick={() => openAssign(user.id)} className="p-2 rounded-lg text-gray-500 hover:bg-green-50 hover:text-green-600" title="Asignar a organización">
                              <Link2 className="w-4 h-4" />
                            </button>
                          )}
                          {user.role !== 'master' && (
                            <>
                              <button onClick={() => openEdit(user)} className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600" title="Editar">
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button onClick={() => setDeleteTarget(user)} className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600" title="Eliminar">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Nombre Completo" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Nombre del usuario" />
          <Input label="Correo Electrónico" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            disabled={!!editingUser} required={!editingUser} placeholder="correo@empresa.com" />
          {!editingUser && (
            <Input label="Contraseña" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Contraseña temporal (opcional, se generará una por defecto)" />
          )}
          <Select label="Rol" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {roleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700">Usuario activo</span>
          </label>
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>

      {/* Assign Modal (master only) */}
      <Modal open={assignModalOpen} onClose={() => setAssignModalOpen(false)} title="Asignar a Organización" size="sm">
        <form onSubmit={handleAssign} className="space-y-4">
          <Select label="Organización" value={assignForm.organization_id} onChange={(e) => setAssignForm({ ...assignForm, organization_id: e.target.value })} required>
            <option value="">Seleccione una organización</option>
            {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </Select>
          <Select label="Rol en la Organización" value={assignForm.role} onChange={(e) => setAssignForm({ ...assignForm, role: e.target.value })}>
            <option value="user">Colaborador</option>
            <option value="admin">Administrador</option>
          </Select>
          {assignError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{assignError}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setAssignModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={assignSaving}>{assignSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Asignando...</> : 'Asignar'}</Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <Modal open={!!deleteTarget} onClose={() => { setDeleteTarget(null); setError(''); }} title={isMaster ? 'Eliminar Usuario' : 'Remover de la Organización'} size="sm">
        <div>
          <p className="text-sm text-gray-600 mb-4">
            {isMaster
              ? <>¿Está seguro de eliminar el usuario <strong>{deleteTarget?.full_name || deleteTarget?.email}</strong>? Esta acción no se puede deshacer.</>
              : <>¿Remover a <strong>{deleteTarget?.full_name || deleteTarget?.email}</strong> de la organización <strong>{activeOrg?.name}</strong>?</>
            }
          </p>
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 mb-4"><p className="text-sm text-red-700">{error}</p></div>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setError(''); }}>Cancelar</Button>
            <Button variant="danger" onClick={handleDelete}>Sí, Continuar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
