import { useEffect, useState } from 'react';
import { Wallet, Plus, Trash2, Pencil, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { supabase, CashEntry, AccountingDocument, ThirdParty } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, formatShortDate, cashTypeLabels, paymentMethodLabels, accountingDocLabels, defaultAccountingDocs } from '@/lib/format';

export default function CajaPage() {
  const { activeOrg } = useOrg();
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [docs, setDocs] = useState<AccountingDocument[]>([]);
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ type: 'ingreso', date: new Date().toISOString().slice(0, 10), concept: '', amount: '', payment_method: 'efectivo', reference: '', third_party_id: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CashEntry | null>(null);
  const [editTarget, setEditTarget] = useState<CashEntry | null>(null);
  const [editForm, setEditForm] = useState({ date: '', concept: '', amount: '', payment_method: 'efectivo', reference: '', third_party_id: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => { if (activeOrg) loadEntries(); }, [activeOrg]);

  async function loadEntries() {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data }, { data: docData }, { data: tpData }] = await Promise.all([
      supabase.from('cash_entries').select('*').eq('organization_id', activeOrg.id).order('date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('accounting_documents').select('*').eq('organization_id', activeOrg.id).order('prefix'),
      supabase.from('third_parties').select('*').eq('organization_id', activeOrg.id).eq('is_active', true).order('name'),
    ]);
    setEntries(data || []);
    setDocs(docData || []);
    setThirdParties(tpData || []);
    setLoading(false);
  }

  async function ensureDocs(): Promise<AccountingDocument[]> {
    if (!activeOrg) return [];
    if (docs.length > 0) return docs;
    const toInsert = defaultAccountingDocs.map(d => ({ organization_id: activeOrg.id, prefix: d.prefix, label: d.label, next_consecutive: 1 }));
    await supabase.from('accounting_documents').insert(toInsert);
    const { data } = await supabase.from('accounting_documents').select('*').eq('organization_id', activeOrg.id).order('prefix');
    setDocs(data || []);
    return data || [];
  }

  const ingresos = entries.filter(e => e.type === 'ingreso').reduce((s, e) => s + e.amount, 0);
  const egresos = entries.filter(e => e.type === 'egreso').reduce((s, e) => s + e.amount, 0);
  const saldo = ingresos - egresos;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    if (!activeOrg) return;

    const currentDocs = await ensureDocs();
    const prefix = form.type === 'ingreso' ? 'RC' : 'CE';
    const doc = currentDocs.find(d => d.prefix === prefix);
    if (!doc) {
      setError('No se encontró la configuración del documento ' + prefix + '. Vaya a Plan de Cuentas > Documentos Contables para inicializarlo.');
      setSaving(false); return;
    }

    const docNumber = doc.next_consecutive;

    const { error: err } = await supabase.from('cash_entries').insert({
      organization_id: activeOrg.id, type: form.type, date: form.date, concept: form.concept,
      amount: parseFloat(form.amount) || 0, payment_method: form.payment_method, reference: form.reference,
      document_type: prefix, document_number: docNumber, third_party_id: form.third_party_id || null,
    });
    if (err) { setError(err.message); setSaving(false); return; }

    await supabase.from('accounting_documents').update({ next_consecutive: docNumber + 1 }).eq('id', doc.id);

    setSaving(false); setModalOpen(false);
    setForm({ type: 'ingreso', date: new Date().toISOString().slice(0, 10), concept: '', amount: '', payment_method: 'efectivo', reference: '', third_party_id: '' });
    await loadEntries();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await supabase.from('cash_entries').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null); await loadEntries();
  }

  function openEdit(entry: CashEntry) {
    setEditTarget(entry);
    setEditForm({
      date: entry.date,
      concept: entry.concept,
      amount: String(entry.amount),
      payment_method: entry.payment_method,
      reference: entry.reference,
      third_party_id: entry.third_party_id || '',
    });
    setEditError('');
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true); setEditError('');
    const { error: err } = await supabase.from('cash_entries').update({
      date: editForm.date,
      concept: editForm.concept,
      amount: parseFloat(editForm.amount) || 0,
      payment_method: editForm.payment_method,
      reference: editForm.reference,
      third_party_id: editForm.third_party_id || null,
    }).eq('id', editTarget.id);
    if (err) { setEditError(err.message); setEditSaving(false); return; }
    setEditSaving(false); setEditTarget(null);
    await loadEntries();
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Caja y Egresos</h1>
          <p className="text-gray-500 mt-1">Registro de ingresos y gastos</p>
        </div>
        <Button onClick={() => setModalOpen(true)}><Plus className="w-4 h-4" /> Nuevo Registro</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card><CardBody className="flex items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-green-100"><TrendingUp className="w-6 h-6 text-green-600" /></div>
          <div><p className="text-sm text-gray-500">Ingresos</p><p className="text-xl font-bold text-gray-900">{formatCOP(ingresos)}</p></div>
        </CardBody></Card>
        <Card><CardBody className="flex items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-red-100"><TrendingDown className="w-6 h-6 text-red-600" /></div>
          <div><p className="text-sm text-gray-500">Egresos</p><p className="text-xl font-bold text-gray-900">{formatCOP(egresos)}</p></div>
        </CardBody></Card>
        <Card><CardBody className="flex items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-100"><Wallet className="w-6 h-6 text-blue-600" /></div>
          <div><p className="text-sm text-gray-500">Saldo</p><p className={`text-xl font-bold ${saldo >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCOP(saldo)}</p></div>
        </CardBody></Card>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16"><div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Wallet className="w-8 h-8 text-gray-400" /></div><p className="text-gray-500">No hay registros de caja</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Fecha</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Documento</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Concepto</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Tipo</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Método</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Monto</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Acciones</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map(entry => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-700">{formatShortDate(entry.date)}</td>
                    <td className="px-6 py-4 text-sm">
                      {entry.document_type && entry.document_number ? (
                        <span className="font-mono font-medium text-gray-900">{entry.document_type}-{String(entry.document_number).padStart(4, '0')}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{entry.concept}{entry.reference && <span className="text-xs text-gray-400 block">Ref: {entry.reference}</span>}</td>
                    <td className="px-6 py-4"><Badge variant={entry.type === 'ingreso' ? 'green' : 'red'}>{cashTypeLabels[entry.type]}</Badge></td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden md:table-cell">{paymentMethodLabels[entry.payment_method]}</td>
                    <td className={`px-6 py-4 text-right text-sm font-medium ${entry.type === 'ingreso' ? 'text-green-600' : 'text-red-600'}`}>{entry.type === 'ingreso' ? '+' : '-'}{formatCOP(entry.amount)}</td>
                    <td className="px-6 py-4"><div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(entry)} className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600" title="Editar"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setDeleteTarget(entry)} className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nuevo Registro de Caja">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select label="Tipo" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="ingreso">Ingreso</option>
            <option value="egreso">Egreso</option>
          </Select>
          {(() => {
            const prefix = form.type === 'ingreso' ? 'RC' : 'CE';
            const doc = docs.find(d => d.prefix === prefix);
            return (
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-2">
                <p className="text-xs text-blue-700">
                  Se generará automáticamente el documento <strong>{prefix} — {accountingDocLabels[prefix]}</strong>
                  {doc && <> con el número <strong>{doc.next_consecutive}</strong></>}.
                </p>
              </div>
            );
          })()}
          <Input label="Fecha" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          <Select label="Tercero *" value={form.third_party_id} onChange={(e) => setForm({ ...form, third_party_id: e.target.value })} required>
            <option value="">Seleccione un tercero</option>
            {thirdParties.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Input label="Concepto *" value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} required placeholder="Descripción del movimiento" />
          <Input label="Monto (COP) *" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Select label="Método de Pago" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
          </Select>
          <Input label="Referencia" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Opcional" />
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Registrar'}</Button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal — core fields only */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Editar Registro de Caja">
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <Input label="Fecha" type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} required />
          <Select label="Tercero *" value={editForm.third_party_id} onChange={(e) => setEditForm({ ...editForm, third_party_id: e.target.value })} required>
            <option value="">Seleccione un tercero</option>
            {thirdParties.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Input label="Concepto *" value={editForm.concept} onChange={(e) => setEditForm({ ...editForm, concept: e.target.value })} required />
          <Input label="Monto (COP) *" type="number" step="0.01" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} required />
          <Select label="Método de Pago" value={editForm.payment_method} onChange={(e) => setEditForm({ ...editForm, payment_method: e.target.value })}>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
          </Select>
          <Input label="Referencia" value={editForm.reference} onChange={(e) => setEditForm({ ...editForm, reference: e.target.value })} />
          {editError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{editError}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancelar</Button>
            <Button type="submit" disabled={editSaving}>{editSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Guardar Cambios'}</Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar Registro" size="sm">
        <p className="text-sm text-gray-600 mb-4">¿Eliminar el registro <strong>{deleteTarget?.concept}</strong>?</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Sí, Eliminar</Button>
        </div>
      </Modal>
    </div>
  );
}
