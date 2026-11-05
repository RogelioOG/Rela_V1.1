import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Wallet, AlertTriangle } from 'lucide-react';
import { supabase, PaymentMethod, Account } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { accountTypeLabels } from '@/lib/format';

interface FormState {
  name: string;
  account_id: string;
  is_active: boolean;
}

const emptyForm: FormState = { name: '', account_id: '', is_active: true };

export function PaymentMethodsConfig() {
  const { activeOrg } = useOrg();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [treasuryAccounts, setTreasuryAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PaymentMethod | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    setLoadError('');

    const [methodsRes, accountsRes] = await Promise.all([
      supabase
        .from('payment_methods')
        .select('*, account:accounts!account_id(*)')
        .eq('organization_id', activeOrg.id)
        .order('name', { ascending: true }),
      supabase
        .from('accounts')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .eq('type', 'activo')
        .like('code', '1%')
        .order('code', { ascending: true }),
    ]);

    if (methodsRes.error || accountsRes.error) {
      setLoadError('No se pudieron cargar los métodos de pago. Intente nuevamente.');
      setLoading(false);
      return;
    }

    setMethods((methodsRes.data || []) as PaymentMethod[]);
    setTreasuryAccounts((accountsRes.data || []) as Account[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { loadData(); }, [loadData]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setModalOpen(true);
  }

  function openEdit(m: PaymentMethod) {
    setEditing(m);
    setForm({ name: m.name, account_id: m.account_id || '', is_active: m.is_active });
    setFormError('');
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;

    const name = form.name.trim();
    if (!name) {
      setFormError('El nombre del método de pago es obligatorio.');
      return;
    }
    if (!form.account_id) {
      setFormError('Seleccione la cuenta de tesorería donde se registrará el pago.');
      return;
    }

    setSaving(true);
    setFormError('');
    const payload = {
      organization_id: activeOrg.id,
      name,
      account_id: form.account_id,
      is_active: form.is_active,
    };

    const { error } = editing
      ? await supabase.from('payment_methods').update(payload).eq('id', editing.id)
      : await supabase.from('payment_methods').insert(payload);

    setSaving(false);
    if (error) {
      setFormError('No se pudo guardar el método de pago. Intente nuevamente.');
      return;
    }
    setModalOpen(false);
    await loadData();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('payment_methods').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) {
      setLoadError('No se pudo eliminar el método de pago. Puede estar asociado a recibos registrados.');
      setDeleteTarget(null);
      return;
    }
    setDeleteTarget(null);
    await loadData();
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Métodos de Pago</h2>
          <p className="text-sm text-gray-500 mt-1">Formas en que los propietarios pueden pagar y la cuenta de tesorería donde se registra cada una.</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> Nuevo Método</Button>
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{loadError}</p>
        </div>
      )}

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : methods.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Wallet className="w-8 h-8 text-gray-400" /></div>
            <p className="text-gray-500">Aún no hay métodos de pago configurados</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Método</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Cuenta de Tesorería</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Acciones</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {methods.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{m.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {m.account ? `${m.account.code} — ${m.account.name}` : <span className="text-gray-400 italic">Sin asignar</span>}
                    </td>
                    <td className="px-6 py-4"><Badge variant={m.is_active ? 'green' : 'gray'}>{m.is_active ? 'Activo' : 'Inactivo'}</Badge></td>
                    <td className="px-6 py-4"><div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(m)} className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600" title="Editar"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setDeleteTarget(m)} className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Método de Pago' : 'Nuevo Método de Pago'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Nombre del método *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Ej: Efectivo, Transferencia Bancaria, Consignación" />
          <div>
            <Select label="Cuenta de tesorería *" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} required>
              <option value="">— Seleccionar —</option>
              {treasuryAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.code} — {a.name} ({accountTypeLabels[a.type]})</option>
              ))}
            </Select>
            <p className="text-xs text-gray-500 mt-1">Solo se muestran cuentas de activo (clase 1), como Caja o Bancos.</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700">Método activo</span>
          </label>

          {formError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{formError}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar Método de Pago" size="sm">
        <p className="text-sm text-gray-600 mb-4">¿Eliminar el método <strong>{deleteTarget?.name}</strong>? Esta acción no se puede deshacer.</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>{deleting ? 'Eliminando...' : 'Sí, Eliminar'}</Button>
        </div>
      </Modal>
    </div>
  );
}
