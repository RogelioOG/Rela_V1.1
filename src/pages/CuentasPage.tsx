import { useEffect, useState } from 'react';
import { BookOpen, Plus, Loader2, Settings2, Save, FileText, AlertTriangle } from 'lucide-react';
import { supabase, Account, AccountMapping, AccountingDocument } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, accountTypeLabels, movementTypeLabels, movementTypeDescriptions, accountingDocLabels, defaultAccountingDocs, isPH } from '@/lib/format';

type Tab = 'cuentas' | 'mapeo' | 'documentos';

export default function CuentasPage() {
  const { activeOrg } = useOrg();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mappings, setMappings] = useState<AccountMapping[]>([]);
  const [docs, setDocs] = useState<AccountingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('cuentas');
  const [accModalOpen, setAccModalOpen] = useState(false);
  const [accForm, setAccForm] = useState({ code: '', name: '', type: 'activo' });
  const [accSaving, setAccSaving] = useState(false);
  const [accError, setAccError] = useState('');
  const [mappingForm, setMappingForm] = useState<Record<string, string>>({});
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingError, setMappingError] = useState('');
  const [docForms, setDocForms] = useState<Record<string, string>>({});
  const [docSaving, setDocSaving] = useState(false);
  const [docError, setDocError] = useState('');
  const [docMaxConsecutives, setDocMaxConsecutives] = useState<Record<string, number>>({});

  useEffect(() => { if (activeOrg) loadData(); }, [activeOrg]);

  async function loadData() {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: accs }, { data: maps }, { data: docData }] = await Promise.all([
      supabase.from('accounts').select('*').eq('organization_id', activeOrg.id).order('code'),
      supabase.from('account_mappings').select('*, accounts(*)').eq('organization_id', activeOrg.id),
      supabase.from('accounting_documents').select('*').eq('organization_id', activeOrg.id).order('prefix'),
    ]);
    setAccounts(accs || []);
    setMappings(maps || []);
    setDocs(docData || []);

    const formInit: Record<string, string> = {};
    (maps || []).forEach((m: AccountMapping) => { formInit[m.movement_type] = m.account_id; });
    setMappingForm(formInit);

    const docFormInit: Record<string, string> = {};
    (docData || []).forEach((d: AccountingDocument) => { docFormInit[d.prefix] = String(d.next_consecutive); });
    setDocForms(docFormInit);

    const maxConsecutives: Record<string, number> = {};
    (docData || []).forEach((d: AccountingDocument) => { maxConsecutives[d.prefix] = d.next_consecutive; });
    setDocMaxConsecutives(maxConsecutives);

    setLoading(false);
  }

  async function handleAccSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAccSaving(true); setAccError('');
    if (!activeOrg) return;
    const { error: err } = await supabase.from('accounts').insert({ ...accForm, organization_id: activeOrg.id });
    if (err) { setAccError(err.message); setAccSaving(false); return; }
    setAccSaving(false); setAccModalOpen(false);
    setAccForm({ code: '', name: '', type: 'activo' });
    await loadData();
  }

  async function seedDefaultAccounts() {
    if (!activeOrg) return;
    const defaults = [
      { code: '1105', name: 'Caja', type: 'activo' },
      { code: '1110', name: 'Bancos', type: 'activo' },
      { code: '1305', name: 'Clientes', type: 'activo' },
      { code: '1435', name: 'Inventario', type: 'activo' },
      { code: '2105', name: 'Proveedores', type: 'pasivo' },
      { code: '2405', name: 'IVA por Pagar', type: 'pasivo' },
      { code: '3105', name: 'Capital', type: 'patrimonio' },
      { code: '4135', name: 'Ventas', type: 'ingreso' },
      { code: '5105', name: 'Gastos Operacionales', type: 'gasto' },
      { code: '5205', name: 'Costo de Ventas', type: 'gasto' },
    ];
    const records = defaults.map(d => ({ ...d, organization_id: activeOrg.id }));
    await supabase.from('accounts').insert(records).select();
    await loadData();
  }

  async function handleMappingSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMappingSaving(true); setMappingError('');
    if (!activeOrg) return;

    const movementTypes = movementGroups.flatMap(g => g.types);
    const toUpsert = movementTypes
      .filter(mt => mappingForm[mt])
      .map(mt => ({
        organization_id: activeOrg.id,
        movement_type: mt,
        account_id: mappingForm[mt],
      }));

    const { error: delErr } = await supabase.from('account_mappings').delete().eq('organization_id', activeOrg.id);
    if (delErr) { setMappingError(delErr.message); setMappingSaving(false); return; }

    if (toUpsert.length > 0) {
      const { error: insErr } = await supabase.from('account_mappings').insert(toUpsert);
      if (insErr) { setMappingError(insErr.message); setMappingSaving(false); return; }
    }

    setMappingSaving(false);
    await loadData();
  }

  async function handleDocSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDocSaving(true); setDocError('');
    if (!activeOrg) return;

    for (const d of docs) {
      const newVal = parseInt(docForms[d.prefix] || '1', 10);
      if (isNaN(newVal) || newVal < 1) {
        setDocError(`El consecutivo para ${d.prefix} debe ser un número válido mayor o igual a 1.`);
        setDocSaving(false);
        return;
      }
      if (newVal < d.next_consecutive) {
        setDocError(`El consecutivo para ${d.prefix} (${d.label}) no puede ser menor que el último registrado (${d.next_consecutive}).`);
        setDocSaving(false);
        return;
      }
      if (newVal !== d.next_consecutive) {
        const { error } = await supabase.from('accounting_documents').update({ next_consecutive: newVal }).eq('id', d.id);
        if (error) { setDocError(error.message); setDocSaving(false); return; }
      }
    }

    setDocSaving(false);
    await loadData();
  }

  async function seedDefaultDocs() {
    if (!activeOrg) return;
    const existing = docs.map(d => d.prefix);
    const toInsert = defaultAccountingDocs
      .filter(d => !existing.includes(d.prefix))
      .map(d => ({ organization_id: activeOrg.id, prefix: d.prefix, label: d.label, next_consecutive: 1 }));
    if (toInsert.length > 0) {
      await supabase.from('accounting_documents').insert(toInsert);
      await loadData();
    }
  }

  if (!activeOrg) return <NoOrgSelected />;

  const allMovementGroups: { title: string; types: string[] }[] = [
    { title: 'Ventas (Comercio)', types: ['venta_efectivo_caja', 'venta_efectivo_ingreso', 'venta_credito_cartera', 'venta_credito_ingreso', 'iva_recaudado', 'venta_descuento'] },
    { title: 'Costo de Ventas (COGS)', types: ['cogs_costo', 'cogs_inventario'] },
    { title: 'Inventario', types: ['inventario_activo', 'compra_inventario', 'compra_caja', 'salida_inventario_caja'] },
    { title: 'Caja', types: ['caja_ingreso', 'caja_ingreso_contrapartida', 'caja_egreso', 'caja_egreso_contrapartida'] },
    { title: 'Propiedad Horizontal', types: ['recaudo_caja', 'recaudo_ingreso'] },
  ];
  const movementGroups = allMovementGroups.filter(g => g.title !== 'Propiedad Horizontal' || (activeOrg && isPH(activeOrg.type)));

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contabilidad</h1>
          <p className="text-gray-500 mt-1">Plan de Cuentas, Mapeo Contable y Documentos</p>
        </div>
        <div className="flex gap-2">
          {tab === 'cuentas' && accounts.length === 0 && <Button variant="outline" onClick={seedDefaultAccounts}>Cargar Plan Estándar</Button>}
          {tab === 'cuentas' && <Button onClick={() => setAccModalOpen(true)}><Plus className="w-4 h-4" /> Nueva Cuenta</Button>}
          {tab === 'documentos' && docs.length === 0 && <Button variant="outline" onClick={seedDefaultDocs}>Inicializar Documentos</Button>}
        </div>
      </div>

      <div className="flex gap-2 mb-5 flex-wrap">
        <button onClick={() => setTab('cuentas')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'cuentas' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}>Plan de Cuentas</button>
        <button onClick={() => setTab('mapeo')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${tab === 'mapeo' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}><Settings2 className="w-4 h-4" /> Mapeo de Cuentas</button>
        <button onClick={() => setTab('documentos')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${tab === 'documentos' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}><FileText className="w-4 h-4" /> Documentos Contables</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
      ) : tab === 'cuentas' ? (
        <Card>
          {accounts.length === 0 ? (
            <div className="text-center py-16"><div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><BookOpen className="w-8 h-8 text-gray-400" /></div><p className="text-gray-500">No hay cuentas registradas</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Código</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Nombre</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Tipo</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {accounts.map(acc => (
                    <tr key={acc.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-mono text-gray-900">{acc.code}</td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{acc.name}</td>
                      <td className="px-6 py-4"><Badge variant="blue">{accountTypeLabels[acc.type]}</Badge></td>
                      <td className="px-6 py-4"><Badge variant={acc.is_active ? 'green' : 'gray'}>{acc.is_active ? 'Activa' : 'Inactiva'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : tab === 'documentos' ? (
        <Card>
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Documentos Contables Autorizados</h3>
            <p className="text-sm text-gray-500 mt-1">Configure los prefijos y consecutivos de cada tipo de documento contable. El consecutivo no puede ser inferior al último registrado.</p>
          </div>
          {docs.length === 0 ? (
            <CardBody className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><FileText className="w-8 h-8 text-gray-400" /></div>
              <p className="text-gray-500">No hay documentos configurados.</p>
              <Button className="mt-4" variant="outline" onClick={seedDefaultDocs}>Inicializar Documentos</Button>
            </CardBody>
          ) : (
            <form onSubmit={handleDocSubmit}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Prefijo</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Tipo de Documento</th>
                    <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Consecutivo Actual</th>
                    <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Nuevo Consecutivo</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {docs.map(doc => (
                      <tr key={doc.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-mono font-bold text-gray-900">{doc.prefix}</td>
                        <td className="px-6 py-4 text-sm text-gray-700">{doc.label}</td>
                        <td className="px-6 py-4 text-sm text-right font-medium text-gray-900">{doc.next_consecutive}</td>
                        <td className="px-6 py-4 text-right">
                          <input
                            type="number"
                            min={doc.next_consecutive}
                            value={docForms[doc.prefix] ?? ''}
                            onChange={(e) => setDocForms({ ...docForms, [doc.prefix]: e.target.value })}
                            className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {docError && (
                <div className="mx-6 mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700">{docError}</p>
                </div>
              )}
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <p className="text-xs text-gray-500">El nuevo consecutivo debe ser mayor o igual al consecutivo actual.</p>
                <Button type="submit" disabled={docSaving}>
                  {docSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : <><Save className="w-4 h-4" /> Guardar Consecutivos</>}
                </Button>
              </div>
            </form>
          )}
        </Card>
      ) : (
        <Card>
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Mapeo de Cuentas</h3>
            <p className="text-sm text-gray-500 mt-1">Asigne las cuentas contables que el sistema usará automáticamente para cada tipo de movimiento.</p>
          </div>
          {accounts.length === 0 ? (
            <CardBody className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Settings2 className="w-8 h-8 text-gray-400" /></div>
              <p className="text-gray-500">Primero debe crear el plan de cuentas.</p>
              <Button className="mt-4" variant="outline" onClick={seedDefaultAccounts}>Cargar Plan Estándar</Button>
            </CardBody>
          ) : (
            <form onSubmit={handleMappingSubmit}>
              <div className="px-6 py-4 space-y-6">
                {movementGroups.map(group => (
                  <div key={group.title}>
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-100">{group.title}</h4>
                    <div className="space-y-3">
                      {group.types.map(mt => {
                        const currentMapping = mappings.find(m => m.movement_type === mt);
                        return (
                          <div key={mt} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                            <div className="sm:col-span-1">
                              <p className="text-sm font-medium text-gray-900">{movementTypeLabels[mt]}</p>
                              <p className="text-xs text-gray-500">{movementTypeDescriptions[mt]}</p>
                            </div>
                            <div className="sm:col-span-1">
                              <select
                                value={mappingForm[mt] || ''}
                                onChange={(e) => setMappingForm({ ...mappingForm, [mt]: e.target.value })}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">Sin asignar (automático)</option>
                                {accounts.map(a => (
                                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-1">
                              {currentMapping ? (
                                <Badge variant="green">Configurado</Badge>
                              ) : (
                                <Badge variant="gray">Automático</Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {mappingError && <div className="mx-6 mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{mappingError}</p></div>}
              <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
                <Button type="submit" disabled={mappingSaving}>
                  {mappingSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : <><Save className="w-4 h-4" /> Guardar Mapeo</>}
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      {/* Account Modal */}
      <Modal open={accModalOpen} onClose={() => setAccModalOpen(false)} title="Nueva Cuenta">
        <form onSubmit={handleAccSubmit} className="space-y-4">
          <Input label="Código *" value={accForm.code} onChange={(e) => setAccForm({ ...accForm, code: e.target.value })} required placeholder="Ej: 1105" />
          <Input label="Nombre *" value={accForm.name} onChange={(e) => setAccForm({ ...accForm, name: e.target.value })} required placeholder="Ej: Caja" />
          <Select label="Tipo" value={accForm.type} onChange={(e) => setAccForm({ ...accForm, type: e.target.value })}>
            {Object.entries(accountTypeLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          {accError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{accError}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setAccModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={accSaving}>{accSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Crear Cuenta'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
