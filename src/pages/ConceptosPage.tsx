import { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Pencil, Trash2, Loader2, Layers, BookOpen, AlertTriangle, Sparkles, Percent } from 'lucide-react';
import { supabase, BillingConcept, Account } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { billingCategoryLabels, accountClassLabels, accountTypeLabels } from '@/lib/format';

interface FormState {
  code: string;
  name: string;
  description: string;
  category: string;
  account_class: string;
  income_account_id: string;
  counterpart_account_id: string;
  is_active: boolean;
  causa_intereses: boolean;
  maneja_descuento: boolean;
  discount_income_account_id: string;
  discount_counterpart_account_id: string;
}
const emptyForm: FormState = {
  code: '', name: '', description: '', category: 'administracion',
  account_class: 'real', income_account_id: '', counterpart_account_id: '', is_active: true,
  causa_intereses: true, maneja_descuento: false,
  discount_income_account_id: '', discount_counterpart_account_id: '',
};

export default function ConceptosPage() {
  const { activeOrg } = useOrg();
  const [items, setItems] = useState<BillingConcept[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BillingConcept | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BillingConcept | null>(null);

  useEffect(() => { if (activeOrg) loadItems(); }, [activeOrg]);

  const loadItems = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from('billing_concepts')
      .select('*, income_account:accounts!income_account_id(*), counterpart_account:accounts!counterpart_account_id(*), parent_concept:billing_concepts!parent_concept_id(*), discount_income_account:accounts!discount_income_account_id(*), discount_counterpart_account:accounts!discount_counterpart_account_id(*)')
      .eq('organization_id', activeOrg.id)
      .order('is_late_interest', { ascending: true })
      .order('name', { ascending: true });
    setItems(data || []);

    const { data: accs } = await supabase
      .from('accounts')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .eq('is_active', true)
      .order('code', { ascending: true });
    setAccounts(accs || []);
    setLoading(false);
  }, [activeOrg]);

  function filteredAccounts(classType: string): Account[] {
    if (classType === 'real') {
      return accounts.filter(a => ['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto', 'costo', 'costo_ventas'].includes(a.type));
    }
    return accounts.filter(a => ['orden_deudora', 'orden_acreedora'].includes(a.type));
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, code: '', name: '' });
    setError('');
    setModalOpen(true);
  }

  function openEdit(c: BillingConcept) {
    setEditing(c);
    setForm({
      code: c.code,
      name: c.name,
      description: c.description,
      category: c.category,
      account_class: c.account_class,
      income_account_id: c.income_account_id || '',
      counterpart_account_id: c.counterpart_account_id || '',
      is_active: c.is_active,
      causa_intereses: c.causa_intereses ?? true,
      maneja_descuento: c.maneja_descuento ?? false,
      discount_income_account_id: c.discount_income_account_id || '',
      discount_counterpart_account_id: c.discount_counterpart_account_id || '',
    });
    setError('');
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    if (!activeOrg) return;

    if (!form.code.trim() || !form.name.trim()) {
      setError('El código y el nombre del concepto son obligatorios.');
      setSaving(false);
      return;
    }

    const payload = {
      organization_id: activeOrg.id,
      code: form.code.toUpperCase(),
      name: form.name,
      description: form.description,
      category: form.category,
      account_class: form.account_class,
      income_account_id: form.income_account_id || null,
      counterpart_account_id: form.counterpart_account_id || null,
      is_active: form.is_active,
      causa_intereses: form.causa_intereses,
      maneja_descuento: form.maneja_descuento,
      discount_income_account_id: form.discount_income_account_id || null,
      discount_counterpart_account_id: form.discount_counterpart_account_id || null,
    };

    try {
      let parentId: string | null = null;

      if (editing) {
        const { error: err } = await supabase.from('billing_concepts').update({
          ...payload,
          is_late_interest: editing.is_late_interest,
          is_default: editing.is_default,
        }).eq('id', editing.id);
        if (err) throw err;
        parentId = editing.is_late_interest ? editing.parent_concept_id : editing.id;
      } else {
        const { data: created, error: err } = await supabase.from('billing_concepts').insert(payload).select().single();
        if (err) throw err;
        parentId = created.id;
      }

      // Auto-create late-interest sub-concept if this is a main concept (not already a late interest concept)
      if (parentId && !editing?.is_late_interest) {
        const lateInterestCode = `MORA_${form.code.toUpperCase()}`;
        const lateInterestName = `Intereses de Mora por ${form.name}`;
        const { data: existingLate } = await supabase
          .from('billing_concepts')
          .select('id')
          .eq('organization_id', activeOrg.id)
          .eq('code', lateInterestCode)
          .maybeSingle();

        if (!existingLate) {
          await supabase.from('billing_concepts').insert({
            organization_id: activeOrg.id,
            code: lateInterestCode,
            name: lateInterestName,
            description: `Sub-concepto generado automáticamente para intereses de mora del concepto "${form.name}"`,
            category: 'penalizacion',
            account_class: form.account_class,
            parent_concept_id: parentId,
            is_late_interest: true,
            is_default: false,
            is_active: true,
            causa_intereses: false,
            maneja_descuento: false,
          });
        } else {
          // Update name in case parent concept name changed
          await supabase.from('billing_concepts').update({
            name: lateInterestName,
            parent_concept_id: parentId,
          }).eq('id', existingLate.id);
        }
      }

      setSaving(false);
      setModalOpen(false);
      await loadItems();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar el concepto';
      setError(msg);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await supabase.from('billing_concepts').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null);
    await loadItems();
  }

  async function updateDiscountAccount(conceptId: string, field: 'discount_income_account_id' | 'discount_counterpart_account_id', value: string) {
    setItems(prev => prev.map(c => c.id === conceptId ? { ...c, [field]: value || null } : c));
    await supabase
      .from('billing_concepts')
      .update({ [field]: value || null })
      .eq('id', conceptId);
  }

  if (!activeOrg) return <NoOrgSelected />;

  const mainConcepts = items.filter(c => !c.is_late_interest);
  const lateInterestConcepts = items.filter(c => c.is_late_interest);
  const discountConcepts = items.filter(c => !c.is_late_interest && c.maneja_descuento);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Conceptos de Cobro</h1>
          <p className="text-gray-500 mt-1">Conceptos de facturación con clasificación contable Real vs de Orden</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> Nuevo Concepto</Button>
      </div>

      <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
        <p className="text-sm text-blue-800 flex items-start gap-2">
          <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0" />
          Al crear un concepto, se genera automáticamente el sub-concepto "Intereses de Mora por [Nombre del Concepto]" vinculado como concepto hijo.
        </p>
      </div>

      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Layers className="w-4 h-4" /> Conceptos Principales</h2>
        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
          ) : mainConcepts.length === 0 ? (
            <div className="text-center py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><FileText className="w-8 h-8 text-gray-400" /></div>
              <p className="text-gray-500">No hay conceptos de cobro configurados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Código</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Concepto</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Categoría</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Clasificación</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Cuenta Ingreso</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden xl:table-cell">Cuenta Contrapartida</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Comportamiento</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Acciones</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {mainConcepts.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <span className="text-sm font-mono font-medium text-gray-900">{c.code}</span>
                        {c.is_default && <div><Badge variant="yellow">Obligatorio</Badge></div>}
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-gray-900">{c.name}</p>
                        {c.description && <p className="text-xs text-gray-500 truncate max-w-xs">{c.description}</p>}
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell"><Badge variant="gray">{billingCategoryLabels[c.category]}</Badge></td>
                      <td className="px-6 py-4 hidden lg:table-cell">
                        <Badge variant={c.account_class === 'real' ? 'blue' : 'purple'}>
                          {c.account_class === 'real' ? 'Real (1-6)' : 'Orden (8-9)'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 hidden lg:table-cell">
                        {c.income_account ? `${c.income_account.code} — ${c.income_account.name}` : 'No asignada'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 hidden xl:table-cell">
                        {c.counterpart_account ? `${c.counterpart_account.code} — ${c.counterpart_account.name}` : 'No asignada'}
                      </td>
                      <td className="px-6 py-4 hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {c.causa_intereses && <Badge variant="yellow">Causa intereses</Badge>}
                          {c.maneja_descuento && <Badge variant="green">Con descuento</Badge>}
                          {!c.causa_intereses && !c.maneja_descuento && <span className="text-xs text-gray-400">—</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4"><Badge variant={c.is_active ? 'green' : 'gray'}>{c.is_active ? 'Activo' : 'Inactivo'}</Badge></td>
                      <td className="px-6 py-4"><div className="flex justify-end gap-2">
                        <button onClick={() => openEdit(c)} className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setDeleteTarget(c)} className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {discountConcepts.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Percent className="w-4 h-4" /> Conceptos con Descuento (Configuración Contable)</h2>
          <p className="text-xs text-gray-500 mb-3">Estos conceptos tienen habilitada la opción "Maneja Descuento". Parametrice exclusivamente las cuentas contables para el registro de descuentos por pronto pago.</p>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Código</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Concepto</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Cuenta de Descuento</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {discountConcepts.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4"><span className="text-sm font-mono font-medium text-gray-900">{c.code}</span></td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{c.name}</td>
                      <td className="px-6 py-4">
                        <select
                          value={c.discount_income_account_id || ''}
                          onChange={(e) => updateDiscountAccount(c.id, 'discount_income_account_id', e.target.value)}
                          className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                        >
                          <option value="">— Seleccionar —</option>
                          {filteredAccounts(c.account_class).map(a => (
                            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-4"><Badge variant={c.is_active ? 'green' : 'gray'}>{c.is_active ? 'Activo' : 'Inactivo'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {lateInterestConcepts.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Sub-conceptos de Intereses de Mora (Auto-generados)</h2>
          <p className="text-xs text-gray-500 mb-3">Los sub-conceptos son totalmente editables: seleccione las cuentas contables de ingreso y contrapartida para que otros módulos puedan leerlas.</p>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Código</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Sub-concepto</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Concepto Padre</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Cuenta Ingreso</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden xl:table-cell">Cuenta Contrapartida</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Acciones</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {lateInterestConcepts.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4"><span className="text-sm font-mono font-medium text-gray-900">{c.code}</span></td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{c.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-700 hidden md:table-cell">
                        {c.parent_concept ? c.parent_concept.name : 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 hidden lg:table-cell">
                        {c.income_account ? `${c.income_account.code} — ${c.income_account.name}` : <span className="text-gray-400 italic">Sin asignar</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 hidden xl:table-cell">
                        {c.counterpart_account ? `${c.counterpart_account.code} — ${c.counterpart_account.name}` : <span className="text-gray-400 italic">Sin asignar</span>}
                      </td>
                      <td className="px-6 py-4"><Badge variant={c.is_active ? 'green' : 'gray'}>{c.is_active ? 'Activo' : 'Inactivo'}</Badge></td>
                      <td className="px-6 py-4"><div className="flex justify-end gap-2">
                        <button onClick={() => openEdit(c)} className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600" title="Editar sub-concepto"><Pencil className="w-4 h-4" /></button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Concepto' : 'Nuevo Concepto'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Código *" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required placeholder="Ej: ADM" disabled={editing?.is_late_interest} />
            <Select label="Categoría" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} disabled={editing?.is_late_interest}>
              {Object.entries(billingCategoryLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <div className="sm:col-span-2">
              <Input label="Nombre del Concepto *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Ej: Cuota de Administración" />
            </div>
            <div className="sm:col-span-2">
              <Input label="Descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descripción opcional del concepto" />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><BookOpen className="w-4 h-4" /> Clasificación Contable</h3>
            <div className="grid grid-cols-1 gap-4">
              <Select label="Clasificación de Cuenta" value={form.account_class} onChange={(e) => setForm({ ...form, account_class: e.target.value, income_account_id: '', counterpart_account_id: '' })}>
                <option value="real">Cuentas Reales (Clases 1-6 — PUC/NIIF)</option>
                <option value="orden">Cuentas de Orden (Clases 8 y 9)</option>
              </Select>
              <p className="text-xs text-gray-500 -mt-2">
                {form.account_class === 'real'
                  ? 'Cuentas que afectan el balance: Activos, Pasivos, Patrimonio, Ingresos, Gastos y Costos.'
                  : 'Cuentas de control y memo que no afectan el balance general.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Cuenta de Ingreso / Orden" value={form.income_account_id} onChange={(e) => setForm({ ...form, income_account_id: e.target.value })}>
              <option value="">— Seleccionar —</option>
              {filteredAccounts(form.account_class).map(a => (
                <option key={a.id} value={a.id}>{a.code} — {a.name} ({accountTypeLabels[a.type]})</option>
              ))}
            </Select>
            <Select label="Cuenta Contrapartida (Contra-cuenta)" value={form.counterpart_account_id} onChange={(e) => setForm({ ...form, counterpart_account_id: e.target.value })}>
              <option value="">— Seleccionar —</option>
              {filteredAccounts(form.account_class).map(a => (
                <option key={a.id} value={a.id}>{a.code} — {a.name} ({accountTypeLabels[a.type]})</option>
              ))}
            </Select>
          </div>

          {form.income_account_id && form.counterpart_account_id && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-600">
                <strong>Flujo contable:</strong> Al registrar un cobro de este concepto, se debitará la cuenta contrapartida y se acreditará la cuenta de ingreso. Las cuentas de orden se registran como movimiento de control sin afectar el balance.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50">
              <input type="checkbox" checked={form.causa_intereses} onChange={(e) => setForm({ ...form, causa_intereses: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <div>
                <span className="text-sm font-medium text-gray-900">Causa Intereses de Mora</span>
                <p className="text-xs text-gray-500">Genera interés sobre saldos vencidos de este concepto.</p>
              </div>
            </label>
            <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50">
              <input type="checkbox" checked={form.maneja_descuento} onChange={(e) => setForm({ ...form, maneja_descuento: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <div>
                <span className="text-sm font-medium text-gray-900">Maneja Descuento</span>
                <p className="text-xs text-gray-500">Aplica descuento por pronto pago en este concepto.</p>
              </div>
            </label>
          </div>

          {form.maneja_descuento && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-4 space-y-3">
              <p className="text-sm font-semibold text-green-800">Cuentas Contables para Descuentos</p>
              <p className="text-xs text-green-700">Parametrice las cuentas exclusivas para el registro de descuentos por pronto pago de este concepto.</p>
              <Select label="Cuenta de Descuento" value={form.discount_income_account_id} onChange={(e) => setForm({ ...form, discount_income_account_id: e.target.value })}>
                <option value="">— Seleccionar —</option>
                {filteredAccounts(form.account_class).map(a => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name} ({accountTypeLabels[a.type]})</option>
                ))}
              </Select>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700">Concepto activo</span>
          </label>

          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar Concepto" size="sm">
        <p className="text-sm text-gray-600 mb-4">
          ¿Eliminar el concepto <strong>{deleteTarget?.name}</strong>?
          {deleteTarget && !deleteTarget.is_late_interest && (
            <span className="block mt-2 text-amber-600">Se eliminará también su sub-concepto de intereses de mora asociado.</span>
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
