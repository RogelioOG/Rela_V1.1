import { useEffect, useState } from 'react';
import { BookOpen, Plus, Trash2, Pencil, Loader2, ChevronRight, ChevronDown, AlertTriangle, Calendar, Lock, Unlock, Clock, Hash } from 'lucide-react';
import { supabase, Account, JournalEntry, JournalLine, AccountingDocument, AccountingPeriod, ThirdParty } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, formatShortDate, formatDateTime, defaultAccountingDocs } from '@/lib/format';

interface EditLine {
  id?: string;
  account_id: string;
  debit: string;
  credit: string;
  third_party_id: string;
}

const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function monthLabel(month: number, year: number): string {
  return `${monthNames[month - 1]} ${year}`;
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function pad4(n?: number | string | null): string {
  if (n === undefined || n === null || n === '') return '0000';
  return String(n).padStart(4, '0');
}

function monthRange(month: number, year: number): { start: string; end: string } {
  const start = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  return { start, end };
}

export default function AsientosPage() {
  const { activeOrg, isOrgAdmin } = useOrg();
  const { profile } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<(JournalEntry & { journal_lines?: JournalLine[] })[]>([]);
  const [docs, setDocs] = useState<AccountingDocument[]>([]);
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([]);
  const [activePeriodId, setActivePeriodId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterDocType, setFilterDocType] = useState('');
  const [filterPeriodId, setFilterPeriodId] = useState('');

  // Entry modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDocNumber, setEditingDocNumber] = useState<number | null>(null);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), description: '', document_type: 'NT' });
  const [lines, setLines] = useState<EditLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [periodError, setPeriodError] = useState('');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<(JournalEntry & { journal_lines?: JournalLine[] }) | null>(null);

  // Period management modal
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [newPeriodMonth, setNewPeriodMonth] = useState(String(new Date().getMonth() + 1));
  const [newPeriodYear, setNewPeriodYear] = useState(String(new Date().getFullYear()));
  const [closePrevious, setClosePrevious] = useState(true);
  const [periodSaving, setPeriodSaving] = useState(false);
  const [closeTargetPeriod, setCloseTargetPeriod] = useState<AccountingPeriod | null>(null);

  const canManagePeriods = isOrgAdmin || profile?.role === 'master';

  useEffect(() => { if (activeOrg) loadData(); }, [activeOrg]);

  async function loadData() {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: accs }, { data: jes }, { data: docData }, { data: periodData }, { data: tpData }] = await Promise.all([
      supabase.from('accounts').select('*').eq('organization_id', activeOrg.id).order('code'),
      supabase.from('journal_entries').select('*, journal_lines(*)').eq('organization_id', activeOrg.id).eq('is_manual', true).order('date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('accounting_documents').select('*').eq('organization_id', activeOrg.id).order('prefix'),
      supabase.from('accounting_periods').select('*').eq('organization_id', activeOrg.id).order('year', { ascending: false }).order('month', { ascending: false }),
      supabase.from('third_parties').select('*').eq('organization_id', activeOrg.id).eq('is_active', true).order('name'),
    ]);
    setAccounts(accs || []);
    setEntries(jes || []);
    setDocs(docData || []);
    setThirdParties(tpData || []);
    const sortedPeriods = (periodData || []).sort((a, b) => b.year - a.year || b.month - a.month);
    setPeriods(sortedPeriods);
    const openPeriod = sortedPeriods.find(p => p.status === 'open');
    if (openPeriod) setActivePeriodId(openPeriod.id);
    setLoading(false);
  }

  const activePeriod = periods.find(p => p.id === activePeriodId);

  async function ensureDocs(): Promise<AccountingDocument[]> {
    if (!activeOrg) return [];
    if (docs.length > 0) return docs;
    const toInsert = defaultAccountingDocs.map(d => ({ organization_id: activeOrg.id, prefix: d.prefix, label: d.label, next_consecutive: 1 }));
    await supabase.from('accounting_documents').insert(toInsert);
    const { data } = await supabase.from('accounting_documents').select('*').eq('organization_id', activeOrg.id).order('prefix');
    setDocs(data || []);
    return data || [];
  }

  async function checkPeriodClosed(dateStr: string): Promise<boolean> {
    if (!activeOrg) return false;
    const { data } = await supabase.rpc('is_period_closed', { p_org_id: activeOrg.id, p_date: dateStr });
    return data === true;
  }

  function openCreate() {
    setEditingId(null);
    setEditingDocNumber(null);
    const defaultDate = activePeriod ? activePeriod.start_date : new Date().toISOString().slice(0, 10);
    setForm({ date: defaultDate, description: '', document_type: 'NT' });
    setLines([{ account_id: '', debit: '', credit: '', third_party_id: '' }, { account_id: '', debit: '', credit: '', third_party_id: '' }]);
    setError('');
    setPeriodError('');
    setModalOpen(true);
  }

  function openEdit(je: JournalEntry & { journal_lines?: JournalLine[] }) {
    setEditingId(je.id);
    setEditingDocNumber(je.document_number ?? null);
    setForm({ date: je.date, description: je.description, document_type: je.document_type || 'NT' });
    setLines((je.journal_lines || []).map(l => ({ id: l.id, account_id: l.account_id, debit: String(l.debit), credit: String(l.credit), third_party_id: l.third_party_id || '' })));
    setError('');
    setPeriodError('');
    setModalOpen(true);
  }

  function addLine() { setLines([...lines, { account_id: '', debit: '', credit: '', third_party_id: '' }]); }
  function removeLine(idx: number) { setLines(lines.filter((_, i) => i !== idx)); }
  function updateLine(idx: number, field: keyof EditLine, value: string) {
    setLines(lines.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(''); setPeriodError('');
    if (!activeOrg) return;

    const closed = await checkPeriodClosed(form.date);
    if (closed) {
      setPeriodError('No se pueden crear ni editar asientos en un periodo cerrado. Abra o cree un nuevo periodo.');
      setSaving(false); return;
    }

    const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      setError('El asiento no está balanceado. Débitos y créditos deben ser iguales.');
      setSaving(false); return;
    }
    const validLines = lines.filter(l => l.account_id);
    if (validLines.length < 2) {
      setError('Se requieren al menos 2 líneas con cuenta asignada.');
      setSaving(false); return;
    }
    if (validLines.some(l => !l.third_party_id)) {
      setError('Cada línea del asiento debe tener un tercero asignado.');
      setSaving(false); return;
    }

    const currentDocs = await ensureDocs();
    const selectedDoc = currentDocs.find(d => d.prefix === form.document_type);
    if (!selectedDoc) {
      setError('Debe seleccionar un tipo de documento contable autorizado.');
      setSaving(false); return;
    }

    if (editingId) {
      const { error: jeErr } = await supabase.from('journal_entries').update({
        date: form.date,
        description: form.description,
        document_type: form.document_type,
      }).eq('id', editingId);

      if (jeErr) { setError(jeErr.message); setSaving(false); return; }

      const existingLines = entries.find(je => je.id === editingId)?.journal_lines || [];
      const lineIdsToDelete = existingLines.map(l => l.id);
      if (lineIdsToDelete.length > 0) {
        await supabase.from('journal_lines').delete().in('id', lineIdsToDelete);
      }

      const newLines = validLines.map(l => ({
        journal_entry_id: editingId,
        account_id: l.account_id,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        third_party_id: l.third_party_id || null,
      }));
      const { error: linesErr } = await supabase.from('journal_lines').insert(newLines);
      if (linesErr) { setError(linesErr.message); setSaving(false); return; }
    } else {
      const docNumber = selectedDoc.next_consecutive;

      const { data: je, error: jeErr } = await supabase.from('journal_entries').insert({
        organization_id: activeOrg.id,
        date: form.date,
        description: form.description,
        document_type: form.document_type,
        document_number: docNumber,
        is_manual: true,
      }).select().single();

      if (jeErr || !je) { setError(jeErr?.message || 'Error al crear el asiento'); setSaving(false); return; }

      const newLines = validLines.map(l => ({
        journal_entry_id: je.id,
        account_id: l.account_id,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        third_party_id: l.third_party_id || null,
      }));
      const { error: linesErr } = await supabase.from('journal_lines').insert(newLines);
      if (linesErr) { setError(linesErr.message); setSaving(false); return; }

      await supabase.from('accounting_documents').update({ next_consecutive: docNumber + 1 }).eq('id', selectedDoc.id);
    }

    setSaving(false); setModalOpen(false);
    await loadData();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await supabase.from('journal_entries').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null); await loadData();
  }

  async function handleCreatePeriod() {
    if (!activeOrg) return;
    setPeriodSaving(true); setError('');
    const month = parseInt(newPeriodMonth);
    const year = parseInt(newPeriodYear);
    const label = monthLabel(month, year);
    const { start, end } = monthRange(month, year);

    const existing = periods.find(p => p.month === month && p.year === year);
    if (existing) {
      setError('Ya existe un periodo para ' + label);
      setPeriodSaving(false); return;
    }

    if (closePrevious) {
      const openPeriods = periods.filter(p => p.status === 'open');
      for (const op of openPeriods) {
        await supabase.from('accounting_periods').update({
          status: 'closed',
          closed_at: new Date().toISOString(),
        }).eq('id', op.id);
      }
    }

    const { data: newPeriod, error: err } = await supabase.from('accounting_periods').insert({
      organization_id: activeOrg.id,
      month,
      year,
      label,
      status: 'open',
      start_date: start,
      end_date: end,
    }).select().single();

    if (err) { setError(err.message); setPeriodSaving(false); return; }

    setPeriodSaving(false);
    setPeriodModalOpen(false);
    await loadData();
    if (newPeriod) setActivePeriodId(newPeriod.id);
  }

  async function handleClosePeriod() {
    if (!closeTargetPeriod) return;
    await supabase.from('accounting_periods').update({
      status: 'closed',
      closed_at: new Date().toISOString(),
    }).eq('id', closeTargetPeriod.id);
    setCloseTargetPeriod(null);
    await loadData();
  }

  async function handleReopenPeriod(period: AccountingPeriod) {
    await supabase.from('accounting_periods').update({
      status: 'open',
      closed_at: null,
    }).eq('id', period.id);
    await loadData();
  }

  const filteredEntries = entries.filter(je => {
    const docMatch = !filterDocType || je.document_type === filterDocType;
    let periodMatch = true;
    if (filterPeriodId) {
      const p = periods.find(pp => pp.id === filterPeriodId);
      if (p) {
        periodMatch = je.date >= p.start_date && je.date <= p.end_date;
      }
    }
    return docMatch && periodMatch;
  });

  if (!activeOrg) return <NoOrgSelected />;

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const selectedDocObj = docs.find(d => d.prefix === form.document_type);
  const displayConsecutive = editingId ? editingDocNumber : selectedDocObj?.next_consecutive;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Asientos Contables</h1>
          <p className="text-gray-500 mt-1">Comprobantes contables, causaciones y recibos sincronizados con consecutivos autorizados</p>
        </div>
        <div className="flex gap-2">
          {canManagePeriods && (
            <Button variant="outline" onClick={() => { setNewPeriodMonth(String(new Date().getMonth() + 1)); setNewPeriodYear(String(new Date().getFullYear())); setClosePrevious(true); setError(''); setPeriodModalOpen(true); }}>
              <Calendar className="w-4 h-4" /> Gestionar Periodos
            </Button>
          )}
          <Button onClick={openCreate}><Plus className="w-4 h-4" /> Nuevo Asiento</Button>
        </div>
      </div>

      {/* Active Period Banner */}
      {activePeriod && (
        <div className="mb-4 flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
          <Calendar className="w-5 h-5 text-blue-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-900">Periodo Activo: {activePeriod.label}</p>
            <p className="text-xs text-blue-600">{formatShortDate(activePeriod.start_date)} — {formatShortDate(activePeriod.end_date)}</p>
          </div>
          <Badge variant="green">Abierto</Badge>
        </div>
      )}
      {!activePeriod && periods.length > 0 && (
        <div className="mb-4 flex items-center gap-3 p-3 rounded-lg bg-yellow-50 border border-yellow-200">
          <AlertTriangle className="w-5 h-5 text-yellow-600" />
          <p className="text-sm text-yellow-800">No hay un periodo abierto. Seleccione o cree un periodo para registrar asientos.</p>
        </div>
      )}
      {periods.length === 0 && !loading && (
        <div className="mb-4 flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
          <Clock className="w-5 h-5 text-gray-500" />
          <p className="text-sm text-gray-600">No hay periodos contables creados. {canManagePeriods ? 'Use "Gestionar Periodos" para crear el primer periodo.' : 'Contacte al administrador.'}</p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tipo de Documento</label>
          <select value={filterDocType} onChange={(e) => setFilterDocType(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]">
            <option value="">Todos los documentos</option>
            {docs.map(d => <option key={d.prefix} value={d.prefix}>{d.prefix} — {d.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Periodo Contable</label>
          <select value={filterPeriodId} onChange={(e) => setFilterPeriodId(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]">
            <option value="">Todos los periodos</option>
            {periods.map(p => <option key={p.id} value={p.id}>{p.label} {p.status === 'closed' ? '(Cerrado)' : '(Abierto)'}</option>)}
          </select>
        </div>
        {(filterDocType || filterPeriodId) && (
          <button onClick={() => { setFilterDocType(''); setFilterPeriodId(''); }} className="text-xs text-blue-600 hover:text-blue-700 font-medium self-end pb-2">
            Limpiar filtros
          </button>
        )}
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><BookOpen className="w-8 h-8 text-gray-400" /></div>
            <p className="text-gray-500">No hay asientos contables registrados</p>
            <p className="text-sm text-gray-400 mt-1">Cree un nuevo asiento o registre un documento para comenzar.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredEntries.map(je => {
              const expanded = expandedEntry === je.id;
              const debit = (je.journal_lines || []).reduce((s, l) => s + l.debit, 0);
              const docPrefix = je.document_type || 'NT';
              const formattedNum = `${docPrefix}-${pad4(je.document_number)}`;
              return (
                <div key={je.id}>
                  <div className="flex items-center justify-between px-6 py-3 hover:bg-gray-50">
                    <button onClick={() => setExpandedEntry(expanded ? null : je.id)} className="flex items-center gap-3 flex-1 min-w-0">
                      {expanded ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                      <div className="text-left min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{je.description || 'Sin descripción'}</p>
                        <p className="text-xs text-gray-500">
                          {formatShortDate(je.date)} · <span className="font-semibold text-blue-700">{formattedNum}</span>
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-sm font-medium text-gray-900">{formatCOP(debit)}</span>
                      <button onClick={() => openEdit(je)} className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600" title="Editar">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteTarget(je)} className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600" title="Eliminar">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {expanded && je.journal_lines && (
                    <div className="px-12 py-3 bg-gray-50">
                      <table className="w-full text-sm">
                        <thead><tr className="text-xs text-gray-500 border-b border-gray-200">
                          <th className="text-left py-1.5">Cuenta</th><th className="text-left py-1.5">Tercero</th><th className="text-right py-1.5">Débito</th><th className="text-right py-1.5">Crédito</th>
                        </tr></thead>
                        <tbody className="divide-y divide-gray-100">
                          {je.journal_lines.map(line => {
                            const acc = accounts.find(a => a.id === line.account_id);
                            const tp = thirdParties.find(t => t.id === line.third_party_id);
                            return (
                              <tr key={line.id}>
                                <td className="py-1.5 text-gray-700">{acc ? `${acc.code} — ${acc.name}` : 'N/A'}</td>
                                <td className="py-1.5 text-gray-600">{tp ? tp.name : '—'}</td>
                                <td className="py-1.5 text-right text-gray-900">{line.debit > 0 ? formatCOP(line.debit) : '-'}</td>
                                <td className="py-1.5 text-right text-gray-900">{line.credit > 0 ? formatCOP(line.credit) : '-'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Create/Edit Entry Modal - Ampliado al 92% de ancho de pantalla */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          editingId
            ? `Editar Asiento Contable · ${form.document_type}-${pad4(editingDocNumber)}`
            : 'Nuevo Asiento Contable'
        }
        size="xl"
        className="!max-w-[92vw] w-full"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {periodError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-2">
              <Lock className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700">{periodError}</p>
            </div>
          )}

          {/* Banner de Consecutivo Visible */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Hash className="w-5 h-5 text-blue-600" />
              <div>
                <p className="text-xs font-medium text-blue-700 uppercase tracking-wider">
                  {editingId ? 'Consecutivo del Documento Registrado' : 'Próximo Consecutivo Parametrizado'}
                </p>
                <p className="text-base font-bold text-blue-950">
                  {form.document_type}-{pad4(displayConsecutive)}
                  {selectedDocObj ? ` (${selectedDocObj.label})` : ''}
                </p>
              </div>
            </div>
            <Badge variant="blue">{editingId ? 'Modo Edición' : 'Consecutivo Automático'}</Badge>
          </div>

          {/* Datos de Encabezado con amplio espacio */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-3">
              <Input label="Fecha *" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div className="md:col-span-4">
              <Select
                label="Documento Contable *"
                value={form.document_type}
                onChange={(e) => setForm({ ...form, document_type: e.target.value })}
                disabled={!!editingId}
                required
              >
                {docs.length === 0 ? (
                  <option value="NT">NT — Comprobante Contable</option>
                ) : (
                  docs.map(d => <option key={d.prefix} value={d.prefix}>{d.prefix} — {d.label}</option>)
                )}
              </Select>
            </div>
            <div className="md:col-span-5">
              <Input label="Descripción / Concepto General" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ej: Recibo de Caja No. RC-0001 o ajuste contable..." />
            </div>
          </div>

          {/* Sección de Líneas del Asiento con columnas amplias */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <p className="text-sm font-semibold text-gray-800">Detalle de Movimientos (Partida Doble)</p>
              <Button type="button" size="sm" variant="outline" onClick={addLine}>
                <Plus className="w-4 h-4" /> Agregar Línea
              </Button>
            </div>

            {/* Encabezados de la tabla de líneas */}
            <div className="hidden lg:grid lg:grid-cols-12 gap-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <div className="lg:col-span-4">Cuenta Contable *</div>
              <div className="lg:col-span-3">Tercero *</div>
              <div className="lg:col-span-2 text-right">Débito ($)</div>
              <div className="lg:col-span-2 text-right">Crédito ($)</div>
              <div className="lg:col-span-1 text-center">Acción</div>
            </div>

            <div className="space-y-2.5 max-h-[45vh] overflow-y-auto pr-1">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center bg-gray-50/70 p-2.5 rounded-lg border border-gray-200/80">
                  <div className="lg:col-span-4">
                    <label className="block lg:hidden text-xs text-gray-500 mb-1">Cuenta Contable</label>
                    <select
                      value={line.account_id}
                      onChange={(e) => updateLine(idx, 'account_id', e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Seleccione cuenta contable...</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                    </select>
                  </div>

                  <div className="lg:col-span-3">
                    <label className="block lg:hidden text-xs text-gray-500 mb-1">Tercero</label>
                    <select
                      value={line.third_party_id}
                      onChange={(e) => updateLine(idx, 'third_party_id', e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Seleccione tercero...</option>
                      {thirdParties.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>

                  <div className="lg:col-span-2">
                    <label className="block lg:hidden text-xs text-gray-500 mb-1">Débito</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={line.debit}
                      onChange={(e) => updateLine(idx, 'debit', e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <label className="block lg:hidden text-xs text-gray-500 mb-1">Crédito</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={line.credit}
                      onChange={(e) => updateLine(idx, 'credit', e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="lg:col-span-1 flex justify-end lg:justify-center">
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      className="p-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors"
                      title="Eliminar línea"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {lines.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-4 bg-gray-100 rounded-lg px-4 py-3 text-sm border border-gray-200">
                <span className="font-semibold text-gray-700">Sumas Iguales (Balance):</span>
                <div className="flex flex-wrap gap-6">
                  <span className={Math.abs(totalDebit - totalCredit) < 0.01 ? 'text-green-700 font-bold' : 'text-red-600 font-bold'}>
                    Total Débito: {formatCOP(totalDebit)}
                  </span>
                  <span className={Math.abs(totalDebit - totalCredit) < 0.01 ? 'text-green-700 font-bold' : 'text-red-600 font-bold'}>
                    Total Crédito: {formatCOP(totalCredit)}
                  </span>
                  {Math.abs(totalDebit - totalCredit) >= 0.01 && (
                    <span className="text-red-600 font-semibold">
                      Diferencia: {formatCOP(Math.abs(totalDebit - totalCredit))}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-3 border-t border-gray-200">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : (editingId ? 'Guardar Cambios' : 'Crear Asiento')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar Asiento" size="sm">
        <p className="text-sm text-gray-600 mb-2">¿Eliminar el asiento <strong>{deleteTarget?.description || 'Sin descripción'}</strong>?</p>
        <p className="text-xs text-gray-400 mb-4">Esta acción no se puede deshacer. Se eliminarán todas las líneas del asiento.</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Sí, Eliminar</Button>
        </div>
      </Modal>

      {/* Period Management Modal */}
      <Modal open={periodModalOpen} onClose={() => setPeriodModalOpen(false)} title="Gestionar Periodos Contables" size="lg">
        <div className="space-y-5">
          <div className="rounded-lg border border-gray-200 p-4 space-y-3">
            <h4 className="text-sm font-semibold text-gray-700">Crear Nuevo Periodo</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select label="Mes" value={newPeriodMonth} onChange={(e) => setNewPeriodMonth(e.target.value)}>
                {monthNames.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
              </Select>
              <Input label="Año" type="number" value={newPeriodYear} onChange={(e) => setNewPeriodYear(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={closePrevious} onChange={(e) => setClosePrevious(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span className="text-sm text-gray-700">Cerrar periodo(s) anterior(es) al crear este (cierre de periodo)</span>
            </label>
            {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2"><p className="text-xs text-red-700">{error}</p></div>}
            <Button onClick={handleCreatePeriod} disabled={periodSaving} size="sm">
              {periodSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Creando...</> : <><Plus className="w-4 h-4" /> Crear Periodo</>}
            </Button>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Periodos Existentes</h4>
            {periods.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No hay periodos creados</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {periods.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-3">
                      {p.status === 'closed' ? <Lock className="w-4 h-4 text-gray-400" /> : <Unlock className="w-4 h-4 text-green-500" />}
                      <div>
                        <p className="text-sm font-medium text-gray-900">{p.label}</p>
                        <p className="text-xs text-gray-500">
                          {formatShortDate(p.start_date)} — {formatShortDate(p.end_date)}
                          {p.closed_at && ` · Cerrado: ${formatDateTime(p.closed_at)}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={p.status === 'open' ? 'green' : 'gray'}>{p.status === 'open' ? 'Abierto' : 'Cerrado'}</Badge>
                      {canManagePeriods && p.status === 'open' && (
                        <button onClick={() => setCloseTargetPeriod(p)} className="text-xs text-red-600 hover:text-red-700 font-medium px-2 py-1">
                          Cerrar
                        </button>
                      )}
                      {canManagePeriods && p.status === 'closed' && (
                        <button onClick={() => handleReopenPeriod(p)} className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1">
                          Reabrir
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Close Period Confirmation */}
      <Modal open={!!closeTargetPeriod} onClose={() => setCloseTargetPeriod(null)} title="Cerrar Periodo" size="sm">
        {closeTargetPeriod && (
          <div className="space-y-4">
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-yellow-800">¿Cerrar el periodo {closeTargetPeriod.label}?</p>
                <p className="text-xs text-yellow-700 mt-1">
                  Al cerrar el periodo, no se podrán crear ni editar asientos con fechas dentro de este rango.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setCloseTargetPeriod(null)}>Cancelar</Button>
              <Button variant="danger" onClick={handleClosePeriod}><Lock className="w-4 h-4" /> Sí, Cerrar Periodo</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}