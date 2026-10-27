import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Plus, Pencil, Trash2, Loader2, AlertTriangle, Upload, Filter, CheckSquare, Square, X, FileSpreadsheet, Bell, CheckCircle2, Download, RefreshCw } from 'lucide-react';
import { supabase, RevenuePeriod, BillingConcept, Unit, PeriodNovelty } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, TextArea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, revenueFrequencyLabels } from '@/lib/format';

const noveltyTypeLabels: Record<string, string> = {
  individual: 'Individual',
  grupo: 'Grupal',
  masivo: 'Masivo',
};

const groupCalcLabels: Record<string, string> = {
  fijo: 'Valor Fijo por Unidad',
  coeficiente: 'Proporcional por Coeficiente',
};

interface FormState {
  id?: string;
  novelty_type: 'individual' | 'grupo' | 'masivo';
  billing_concept_id: string;
  unit_id: string;
  period_label: string;
  description: string;
  value: string;
  group_calculation: 'fijo' | 'coeficiente';
}

const emptyForm: FormState = {
  novelty_type: 'individual',
  billing_concept_id: '',
  unit_id: '',
  period_label: new Date().toISOString().slice(0, 7),
  description: '',
  value: '0',
  group_calculation: 'fijo',
};

interface ImportRow {
  unit_label: string;
  tower: string;
  description: string;
  value: string;
}

export default function NovedadesPage() {
  const { activeOrg } = useOrg();
  const [periods, setPeriods] = useState<RevenuePeriod[]>([]);
  const [concepts, setConcepts] = useState<BillingConcept[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [novelties, setNovelties] = useState<PeriodNovelty[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PeriodNovelty | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState('');
  const [filterConcept, setFilterConcept] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importData, setImportData] = useState<ImportRow[]>([]);
  const [importError, setImportError] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importDuplicates, setImportDuplicates] = useState<{ row: ImportRow; existing: PeriodNovelty }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Duplicate detection state for individual novelty creation
  const [duplicateFound, setDuplicateFound] = useState<PeriodNovelty | null>(null);
  const [pendingSubmit, setPendingSubmit] = useState(false);

  useEffect(() => { if (activeOrg) loadInitial(); }, [activeOrg]);

  const loadInitial = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: periodData }, { data: conceptData }, { data: unitData }] = await Promise.all([
      supabase.from('revenue_periods').select('*').eq('organization_id', activeOrg.id).order('start_date', { ascending: false }),
      supabase.from('billing_concepts').select('*').eq('organization_id', activeOrg.id).eq('is_active', true).order('name'),
      supabase.from('units').select('*').eq('organization_id', activeOrg.id).eq('is_active', true).order('tower').order('unit_label'),
    ]);
    setPeriods(periodData || []);
    setConcepts(conceptData || []);
    setUnits(unitData || []);
    const defaultConcept = (conceptData || []).find(c => c.is_default);
    setForm(f => ({ ...f, billing_concept_id: defaultConcept?.id || (conceptData || [])[0]?.id || '' }));
    await loadNovelties();
    setLoading(false);
  }, [activeOrg]);

  const loadNovelties = useCallback(async () => {
    if (!activeOrg) return;
    const { data } = await supabase
      .from('period_novelties')
      .select('*, billing_concept:billing_concepts(*), units:units(*)')
      .eq('organization_id', activeOrg.id)
      .order('created_at', { ascending: false });
    setNovelties(data || []);
  }, [activeOrg]);

  const filteredNovelties = useMemo(() => {
    return novelties.filter(n => {
      if (filterType && n.novelty_type !== filterType) return false;
      if (filterConcept && n.billing_concept_id !== filterConcept) return false;
      if (filterPeriod && n.period_label !== filterPeriod) return false;
      return true;
    });
  }, [novelties, filterType, filterConcept, filterPeriod]);

  function findDuplicate(unitId: string | null, conceptId: string, periodLabel: string, description: string, excludeId?: string): PeriodNovelty | null {
    return novelties.find(n => {
      if (excludeId && n.id === excludeId) return false;
      if (n.billing_concept_id !== conceptId) return false;
      if (n.period_label !== periodLabel) return false;
      if (n.description.trim().toLowerCase() === description.trim().toLowerCase()) {
        if (unitId === null && n.unit_id === null) return true;
        if (unitId && n.unit_id === unitId) return true;
      }
      return false;
    }) || null;
  }

  function openCreate() {
    setForm({ ...emptyForm, billing_concept_id: concepts.find(c => c.is_default)?.id || concepts[0]?.id || '' });
    setError('');
    setDuplicateFound(null);
    setPendingSubmit(false);
    setModalOpen(true);
  }

  function openEdit(n: PeriodNovelty) {
    setForm({
      id: n.id,
      novelty_type: n.novelty_type,
      billing_concept_id: n.billing_concept_id,
      unit_id: n.unit_id || '',
      period_label: n.period_label,
      description: n.description,
      value: String(n.value),
      group_calculation: n.group_calculation || 'fijo',
    });
    setError('');
    setDuplicateFound(null);
    setPendingSubmit(false);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    if (!activeOrg) return;

    if (!form.billing_concept_id) { setError('Debe seleccionar un concepto.'); setSaving(false); return; }
    if (!form.period_label.trim()) { setError('Debe ingresar un periodo (YYYY-MM).'); setSaving(false); return; }
    if (!form.description.trim()) { setError('La descripción es obligatoria.'); setSaving(false); return; }
    if ((parseFloat(form.value) || 0) <= 0) { setError('El valor debe ser mayor que cero.'); setSaving(false); return; }
    if (form.novelty_type === 'individual' && !form.unit_id) { setError('Debe seleccionar una unidad para novedades individuales.'); setSaving(false); return; }

    const activePeriod = periods.find(p => p.id === periods[0]?.id);
    if (!activePeriod) { setError('No hay periodos de recaudo configurados.'); setSaving(false); return; }

    // Duplicate check for individual and masivo types (not grupo since it applies to all units)
    if (form.novelty_type !== 'grupo' && !form.id) {
      const unitId = form.novelty_type === 'individual' ? form.unit_id : null;
      const dup = findDuplicate(unitId, form.billing_concept_id, form.period_label, form.description);
      if (dup && !pendingSubmit) {
        setDuplicateFound(dup);
        setSaving(false);
        return;
      }
    }

    try {
      if (form.novelty_type === 'grupo') {
        const groupRows: Record<string, unknown>[] = units.map(u => ({
          organization_id: activeOrg.id,
          revenue_period_id: activePeriod.id,
          billing_concept_id: form.billing_concept_id,
          unit_id: u.id,
          novelty_type: 'grupo',
          period_label: form.period_label,
          description: form.description,
          value: form.group_calculation === 'coeficiente'
            ? Math.round((parseFloat(form.value) * u.coefficient) * 100) / 100
            : parseFloat(form.value),
          group_calculation: form.group_calculation,
          is_invoiced: false,
        }));
        if (form.id) {
          await supabase.from('period_novelties').delete().eq('id', form.id);
        }
        const { error: insErr } = await supabase.from('period_novelties').insert(groupRows);
        if (insErr) throw insErr;
      } else {
        // If duplicate was confirmed, update the existing record instead of creating a new one
        if (duplicateFound && pendingSubmit && !form.id) {
          const payload = {
            billing_concept_id: form.billing_concept_id,
            unit_id: form.novelty_type === 'individual' ? form.unit_id : null,
            description: form.description,
            value: parseFloat(form.value),
          };
          const { error: err } = await supabase.from('period_novelties').update(payload).eq('id', duplicateFound.id);
          if (err) throw err;
        } else {
          const payload = {
            organization_id: activeOrg.id,
            revenue_period_id: activePeriod.id,
            billing_concept_id: form.billing_concept_id,
            unit_id: form.novelty_type === 'individual' ? form.unit_id : null,
            novelty_type: form.novelty_type,
            period_label: form.period_label,
            description: form.description,
            value: parseFloat(form.value),
            group_calculation: null,
            is_invoiced: false,
          };
          if (form.id) {
            const { error: err } = await supabase.from('period_novelties').update(payload).eq('id', form.id);
            if (err) throw err;
          } else {
            const { error: err } = await supabase.from('period_novelties').insert(payload);
            if (err) throw err;
          }
        }
      }

      setSaving(false);
      setModalOpen(false);
      setDuplicateFound(null);
      setPendingSubmit(false);
      await loadNovelties();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar la novedad';
      setError(msg);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await supabase.from('period_novelties').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null);
    await loadNovelties();
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    await supabase.from('period_novelties').delete().in('id', ids);
    setSelectedIds(new Set());
    await loadNovelties();
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredNovelties.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredNovelties.map(n => n.id)));
    }
  }

  function downloadCsvTemplate() {
    const csv = 'Unidad,Torre,Descripcion,Valor\n101,Torre A,Ejemplo de novedad,50000\n102,Torre A,Otro ejemplo de novedad,75000\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plantilla_novedades.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportMsg('');
    setImportDuplicates([]);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) { setImportError('Archivo vacío.'); return; }
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { setImportError('El archivo debe tener una fila de encabezado y al menos una fila de datos.'); return; }
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const unitLabelIdx = headers.findIndex(h => h.includes('unidad') || h.includes('unit'));
      const towerIdx = headers.findIndex(h => h.includes('torre') || h.includes('tower'));
      const descIdx = headers.findIndex(h => h.includes('descripcion') || h.includes('description'));
      const valueIdx = headers.findIndex(h => h.includes('valor') || h.includes('value'));
      if (unitLabelIdx === -1 || descIdx === -1 || valueIdx === -1) {
        setImportError('El archivo debe contener columnas: Unidad, Descripcion, Valor (y opcionalmente Torre).');
        return;
      }
      const rows: ImportRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        rows.push({
          unit_label: cols[unitLabelIdx] || '',
          tower: towerIdx >= 0 ? cols[towerIdx] || '' : '',
          description: cols[descIdx] || '',
          value: cols[valueIdx] || '0',
        });
      }
      setImportData(rows);
      setImportMsg(`${rows.length} filas importadas. Revise y confirme para registrar las novedades.`);
    };
    reader.readAsText(file);
  }

  async function confirmImport() {
    if (!activeOrg || importData.length === 0) return;
    setSaving(true);
    setImportError('');
    const activePeriod = periods[0];
    if (!activePeriod) { setImportError('No hay periodos configurados.'); setSaving(false); return; }
    const defaultConcept = concepts.find(c => c.is_default) || concepts[0];
    if (!defaultConcept) { setImportError('No hay conceptos configurados.'); setSaving(false); return; }

    const currentPeriodLabel = new Date().toISOString().slice(0, 7);

    // Detect duplicates against existing novelties
    const duplicates: { row: ImportRow; existing: PeriodNovelty }[] = [];
    const unmatched: string[] = [];
    const matchedUnits: { row: ImportRow; unitId: string }[] = [];

    for (const row of importData) {
      const unit = units.find(u => u.unit_label === row.unit_label && (row.tower === '' || u.tower === row.tower));
      if (!unit) { unmatched.push(row.unit_label); continue; }
      const dup = findDuplicate(unit.id, defaultConcept.id, currentPeriodLabel, row.description);
      if (dup) {
        duplicates.push({ row, existing: dup });
      }
      matchedUnits.push({ row, unitId: unit.id });
    }

    if (unmatched.length > 0) {
      setImportError(`Unidades no encontradas: ${unmatched.join(', ')}. Corrija el archivo o registre las unidades primero.`);
      setSaving(false);
      return;
    }

    if (duplicates.length > 0 && importDuplicates.length === 0) {
      // First pass: show duplicates, ask user to confirm
      setImportDuplicates(duplicates);
      setImportMsg(`Se detectaron ${duplicates.length} novedad(es) duplicada(s). Revise y decida si actualizar los registros existentes o cancelar.`);
      setSaving(false);
      return;
    }

    // Second pass (user confirmed): update duplicates and insert new ones
    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { id: string; description: string; value: number }[] = [];

    for (const { row, unitId } of matchedUnits) {
      const dup = duplicates.find(d => d.row === row);
      if (dup) {
        // Update existing
        toUpdate.push({ id: dup.existing.id, description: row.description, value: parseFloat(row.value) || 0 });
      } else {
        toInsert.push({
          organization_id: activeOrg.id,
          revenue_period_id: activePeriod.id,
          billing_concept_id: defaultConcept.id,
          unit_id: unitId,
          novelty_type: 'masivo',
          period_label: currentPeriodLabel,
          description: row.description,
          value: parseFloat(row.value) || 0,
          group_calculation: null,
          is_invoiced: false,
        });
      }
    }

    if (toInsert.length > 0) {
      const { error: insErr } = await supabase.from('period_novelties').insert(toInsert);
      if (insErr) { setImportError(insErr.message); setSaving(false); return; }
    }
    for (const upd of toUpdate) {
      await supabase.from('period_novelties').update({ description: upd.description, value: upd.value }).eq('id', upd.id);
    }

    const newCount = toInsert.length;
    const updCount = toUpdate.length;
    setImportMsg(`${newCount} novedad(es) nueva(s) registrada(s) y ${updCount} existente(s) actualizada(s).`);
    setImportData([]);
    setImportDuplicates([]);
    setSaving(false);
    setImportOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    await loadNovelties();
  }

  const totalValue = useMemo(() => filteredNovelties.reduce((s, n) => s + n.value, 0), [filteredNovelties]);

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Novedades del Periodo</h1>
          <p className="text-gray-500 mt-1">Cargos individuales, grupales y masivos sobre cuotas de administración</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadCsvTemplate}>
            <Download className="w-4 h-4" /> Plantilla CSV
          </Button>
          <Button variant="outline" onClick={() => { setImportData([]); setImportError(''); setImportMsg(''); setImportDuplicates([]); setImportOpen(true); }}>
            <Upload className="w-4 h-4" /> Importar CSV
          </Button>
          <Button onClick={openCreate}><Plus className="w-4 h-4" /> Nueva Novedad</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
      ) : periods.length === 0 ? (
        <Card><div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Bell className="w-8 h-8 text-gray-400" /></div>
          <p className="text-gray-500">No hay periodos de recaudo configurados.</p>
        </div></Card>
      ) : (
        <div className="space-y-5">
          {/* Filters */}
          <Card>
            <div className="p-4 flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-500"><Filter className="w-4 h-4" /> Filtros:</div>
              <Select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="sm:max-w-[160px]">
                <option value="">Todos los tipos</option>
                <option value="individual">Individual</option>
                <option value="grupo">Grupal</option>
                <option value="masivo">Masivo</option>
              </Select>
              <Select value={filterConcept} onChange={(e) => setFilterConcept(e.target.value)} className="sm:max-w-[200px]">
                <option value="">Todos los conceptos</option>
                {concepts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Input type="text" placeholder="Periodo (YYYY-MM)" value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)} className="sm:max-w-[140px]" />
              {(filterType || filterConcept || filterPeriod) && (
                <button onClick={() => { setFilterType(''); setFilterConcept(''); setFilterPeriod(''); }} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                  <X className="w-3 h-3" /> Limpiar
                </button>
              )}
            </div>
          </Card>

          {/* Bulk actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 rounded-lg bg-blue-50 border border-blue-200 px-4 py-2">
              <span className="text-sm text-blue-800 font-medium">{selectedIds.size} seleccionada(s)</span>
              <Button size="sm" variant="outline" onClick={handleBulkDelete}><Trash2 className="w-3.5 h-3.5" /> Eliminar Seleccionadas</Button>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-blue-600 hover:text-blue-700">Deseleccionar</button>
            </div>
          )}

          {/* Novelties Table */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Bell className="w-5 h-5 text-blue-600" /> Novedades Registradas</h2>
              <span className="text-sm text-gray-500">Total: <strong className="text-gray-900">{formatCOP(totalValue)}</strong></span>
            </div>
            {filteredNovelties.length === 0 ? (
              <div className="text-center py-16">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Bell className="w-8 h-8 text-gray-400" /></div>
                <p className="text-gray-500">No hay novedades registradas</p>
                <p className="text-sm text-gray-400 mt-1">Cree una nueva novedad o importe desde CSV.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 w-10">
                      <button onClick={toggleSelectAll} className="text-gray-400 hover:text-gray-600">
                        {selectedIds.size === filteredNovelties.length && selectedIds.size > 0
                          ? <CheckSquare className="w-5 h-5 text-blue-600" />
                          : <Square className="w-5 h-5" />}
                      </button>
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Tipo</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3 hidden sm:table-cell">Concepto</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3 hidden md:table-cell">Unidad</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3 hidden lg:table-cell">Periodo</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Descripción</th>
                    <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Valor</th>
                    <th className="text-center text-xs font-semibold text-gray-600 uppercase px-4 py-3 hidden sm:table-cell">Estado</th>
                    <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Acciones</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredNovelties.map(n => (
                      <tr key={n.id} className={`hover:bg-gray-50 ${selectedIds.has(n.id) ? 'bg-blue-50' : ''}`}>
                        <td className="px-4 py-3">
                          <button onClick={() => toggleSelect(n.id)} className="text-gray-400 hover:text-gray-600">
                            {selectedIds.has(n.id) ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5" />}
                          </button>
                        </td>
                        <td className="px-4 py-3"><Badge variant={n.novelty_type === 'grupo' ? 'purple' : n.novelty_type === 'masivo' ? 'yellow' : 'blue'}>{noveltyTypeLabels[n.novelty_type]}</Badge></td>
                        <td className="px-4 py-3 text-sm text-gray-700 hidden sm:table-cell">{n.billing_concept?.name || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 hidden md:table-cell">{n.units ? `${n.units.tower} ${n.units.unit_label}` : 'Todas'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 hidden lg:table-cell">{n.period_label}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate">{n.description}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">{formatCOP(n.value)}</td>
                        <td className="px-4 py-3 text-center hidden sm:table-cell">
                          <Badge variant={n.is_invoiced ? 'green' : 'gray'}>{n.is_invoiced ? 'Facturada' : 'Pendiente'}</Badge>
                        </td>
                        <td className="px-4 py-3"><div className="flex justify-end gap-1">
                          <button onClick={() => openEdit(n)} className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => setDeleteTarget(n)} className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={6} className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">Total:</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">{formatCOP(totalValue)}</td>
                    <td colSpan={2} />
                  </tr></tfoot>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Editar Novedad' : 'Nueva Novedad'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-600" /><p className="text-sm text-red-700">{error}</p></div>}

          {/* Duplicate alert */}
          {duplicateFound && (
            <div className="rounded-lg bg-amber-50 border border-amber-300 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">Novedad duplicada detectada</p>
                  <p className="text-sm text-amber-700 mt-1">
                    Ya existe una novedad para el mismo concepto, unidad, periodo y descripción:
                  </p>
                  <div className="mt-2 rounded bg-white p-2 border border-amber-200 text-xs text-gray-700">
                    <strong>{duplicateFound.description}</strong> — Valor actual: {formatCOP(duplicateFound.value)}
                  </div>
                  <p className="text-sm text-amber-700 mt-2">¿Desea actualizar el registro existente con los nuevos valores?</p>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" onClick={() => { setPendingSubmit(true); setDuplicateFound(null); }}>
                      <RefreshCw className="w-3.5 h-3.5" /> Sí, Actualizar Existente
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setDuplicateFound(null); setModalOpen(false); }}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['individual', 'grupo', 'masivo'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setForm(f => ({ ...f, novelty_type: t }))}
                className={`p-3 rounded-xl border-2 text-left transition-all ${form.novelty_type === t ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-4 h-4 rounded-full border-2 ${form.novelty_type === t ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`} />
                  <span className="text-sm font-semibold text-gray-900">{noveltyTypeLabels[t]}</span>
                </div>
                <p className="text-xs text-gray-500">
                  {t === 'individual' && 'Cargo a una sola unidad'}
                  {t === 'grupo' && 'Cargo a todas las unidades'}
                  {t === 'masivo' && 'Cargos desde archivo CSV'}
                </p>
              </button>
            ))}
          </div>

          <Select label="Concepto" value={form.billing_concept_id} onChange={(e) => setForm(f => ({ ...f, billing_concept_id: e.target.value }))}>
            <option value="">Seleccione un concepto...</option>
            {concepts.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </Select>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Periodo (YYYY-MM)" type="text" value={form.period_label} onChange={(e) => setForm(f => ({ ...f, period_label: e.target.value }))} placeholder="2026-01" />
            <Input label="Valor (COP)" type="number" value={form.value} onChange={(e) => setForm(f => ({ ...f, value: e.target.value }))} />
          </div>

          {form.novelty_type === 'individual' && (
            <Select label="Unidad" value={form.unit_id} onChange={(e) => setForm(f => ({ ...f, unit_id: e.target.value }))}>
              <option value="">Seleccione una unidad...</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.tower} — {u.unit_label} ({u.owner_name})</option>)}
            </Select>
          )}

          {form.novelty_type === 'grupo' && (
            <Select label="Cálculo Grupal" value={form.group_calculation} onChange={(e) => setForm(f => ({ ...f, group_calculation: e.target.value as 'fijo' | 'coeficiente' }))}>
              <option value="fijo">{groupCalcLabels.fijo}</option>
              <option value="coeficiente">{groupCalcLabels.coeficiente}</option>
            </Select>
          )}

          {form.novelty_type === 'masivo' && (
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
              <p className="text-sm text-yellow-800">Use el botón "Importar CSV" para cargar novedades masivas desde un archivo.</p>
            </div>
          )}

          <TextArea label="Descripción" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Descripción de la novedad..." />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {form.id ? 'Actualizar' : 'Registrar'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar Novedad" size="sm">
        <p className="text-sm text-gray-600">¿Está seguro de eliminar esta novedad? Esta acción no se puede deshacer.</p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}><Trash2 className="w-4 h-4" /> Eliminar</Button>
        </div>
      </Modal>

      {/* CSV Import Modal */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Importar Novedades desde CSV" size="lg">
        <div className="space-y-4">
          {importError && <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-600" /><p className="text-sm text-red-700">{importError}</p></div>}
          {importMsg && <div className="rounded-lg bg-green-50 border border-green-200 p-3 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" /><p className="text-sm text-green-700">{importMsg}</p></div>}

          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-gray-700">Formato del archivo CSV:</p>
              <Button size="sm" variant="outline" onClick={downloadCsvTemplate}><Download className="w-3.5 h-3.5" /> Descargar Plantilla</Button>
            </div>
            <p className="text-xs text-gray-500 mb-2">Columnas requeridas: Unidad, Descripcion, Valor. Columna opcional: Torre.</p>
            <pre className="text-xs text-gray-600 bg-white rounded p-2 border border-gray-200">Unidad,Torre,Descripcion,Valor{'\n'}101,Torre A,Multa por ruido,50000{'\n'}102,Torre A,Reparación ascensor,75000</pre>
          </div>

          <div className="flex items-center gap-3">
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileUpload} className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
            <FileSpreadsheet className="w-5 h-5 text-gray-400" />
          </div>

          {/* Duplicate alerts for CSV import */}
          {importDuplicates.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-300 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">{importDuplicates.length} novedad(es) duplicada(s) detectada(s)</p>
                  <p className="text-sm text-amber-700 mt-1">Las siguientes filas coinciden con novedades existentes (mismo concepto, unidad, periodo y descripción). Al confirmar, se actualizarán los registros existentes con los nuevos valores.</p>
                  <div className="mt-2 max-h-32 overflow-y-auto rounded bg-white p-2 border border-amber-200">
                    {importDuplicates.map((d, i) => (
                      <div key={i} className="text-xs text-gray-700 py-1 border-b border-amber-100 last:border-0">
                        <strong>{d.row.unit_label}</strong> — {d.row.description} (actual: {formatCOP(d.existing.value)} → nuevo: {formatCOP(parseFloat(d.row.value) || 0)})
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" onClick={() => { setImportDuplicates([]); setImportMsg(''); }}>
                      <RefreshCw className="w-3.5 h-3.5" /> Confirmar y Actualizar Duplicadas
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setImportDuplicates([]); setImportData([]); setImportMsg(''); }}>
                      Cancelar Importación
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {importData.length > 0 && (
            <div className="overflow-x-auto max-h-60 overflow-y-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-3 py-2">Unidad</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-3 py-2">Torre</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-3 py-2">Descripción</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-3 py-2">Valor</th>
                  <th className="text-center text-xs font-semibold text-gray-600 uppercase px-3 py-2">Estado</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {importData.map((row, i) => {
                    const isDup = importDuplicates.some(d => d.row === row);
                    return (
                      <tr key={i} className={`hover:bg-gray-50 ${isDup ? 'bg-amber-50' : ''}`}>
                        <td className="px-3 py-2 text-sm text-gray-900">{row.unit_label}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">{row.tower}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">{row.description}</td>
                        <td className="px-3 py-2 text-sm text-gray-900 text-right">{formatCOP(parseFloat(row.value) || 0)}</td>
                        <td className="px-3 py-2 text-center">
                          {isDup ? <Badge variant="yellow">Duplicada</Badge> : <Badge variant="green">Nueva</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {importDuplicates.length === 0 && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setImportOpen(false)}>Cancelar</Button>
              <Button onClick={confirmImport} disabled={saving || importData.length === 0}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Confirmar Importación ({importData.length})
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
