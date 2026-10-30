import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Home, Plus, Pencil, Trash2, Search, Loader2, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, X, Users } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase, Unit, UnitOwner } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { unitTypeLabels, formatNumber, documentTypeLabelsPH } from '@/lib/format';

interface OwnerFormState {
  document_type: string;
  document_number: string;
  first_name: string;
  last_name: string;
  business_name: string;
  email: string;
  phone: string;
  is_primary: boolean;
}
const emptyOwner: OwnerFormState = {
  document_type: 'CC', document_number: '', first_name: '', last_name: '',
  business_name: '', email: '', phone: '', is_primary: true,
};

interface FormState {
  tower: string;
  unit_label: string;
  type: string;
  coefficient: string;
  built_area: string;
  payment_reference: string;
  is_active: boolean;
  owners: OwnerFormState[];
}
const emptyForm: FormState = {
  tower: '', unit_label: '', type: 'apartamento', coefficient: '0',
  built_area: '', payment_reference: '', is_active: true,
  owners: [{ ...emptyOwner }],
};

interface CellError {
  row: number;
  col: number;
  cellRef: string;
  message: string;
}

interface ParsedRow {
  rowIndex: number;
  data: Record<string, string>;
  errors: CellError[];
}

const EXPECTED_COLUMNS = [
  'Torre', 'Unidad', 'Tipo', 'Coeficiente', 'Area Construida',
  'Tipo Doc Prop 1', 'Documento Prop 1', 'Nombres Prop 1', 'Apellidos Prop 1', 'Razon Social Prop 1',
  'Email Prop 1', 'Telefono Prop 1',
  'Tipo Doc Prop 2', 'Documento Prop 2', 'Nombres Prop 2', 'Apellidos Prop 2', 'Razon Social Prop 2',
  'Email Prop 2', 'Telefono Prop 2',
  'Referencia de Pago',
];

const DOC_TYPES = ['CC', 'NIT', 'CE', 'Pasaporte'];
const UNIT_TYPES = ['apartamento', 'casa', 'local', 'oficina', 'parqueadero'];

function colLetter(index: number): string {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

export default function InmueblesPage() {
  const { activeOrg } = useOrg();
  const [items, setItems] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTower, setFilterTower] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Unit | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [uploadErrors, setUploadErrors] = useState<CellError[]>([]);
  const [uploadValid, setUploadValid] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (activeOrg) loadItems(); }, [activeOrg]);

  const loadItems = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from('units')
      .select('*, unit_owners(*)')
      .eq('organization_id', activeOrg.id)
      .order('tower', { ascending: true })
      .order('unit_label', { ascending: true });
    setItems(data || []);
    setLoading(false);
  }, [activeOrg]);

  const towers = useMemo(() => {
    const set = new Set<string>();
    items.forEach(u => { if (u.tower) set.add(u.tower); });
    return Array.from(set).sort();
  }, [items]);

  const filtered = items.filter(u => {
    if (!search ||
      u.unit_label.toLowerCase().includes(search.toLowerCase()) ||
      u.tower.toLowerCase().includes(search.toLowerCase()) ||
      (u.owner_name || '').toLowerCase().includes(search.toLowerCase())
    ) {
      // passes search
    } else return false;
    if (filterType !== 'all' && u.type !== filterType) return false;
    if (filterStatus === 'active' && !u.is_active) return false;
    if (filterStatus === 'inactive' && u.is_active) return false;
    if (filterTower !== 'all' && u.tower !== filterTower) return false;
    return true;
  });

  function buildUniqueIdentifier(tower: string, unitLabel: string): string {
    const t = tower.trim().toUpperCase();
    const u = unitLabel.trim().toUpperCase();
    return t ? `${t}-${u}` : u;
  }

  async function checkDuplicateIdentifier(tower: string, unitLabel: string, excludeId?: string): Promise<boolean> {
    if (!activeOrg || !unitLabel.trim()) return false;
    const identifier = buildUniqueIdentifier(tower, unitLabel);
    let query = supabase
      .from('units')
      .select('id')
      .eq('organization_id', activeOrg.id)
      .eq('unique_identifier', identifier)
      .eq('is_active', true);
    if (excludeId) query = query.neq('id', excludeId);
    const { data } = await query.maybeSingle();
    return !!data;
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, owners: [{ ...emptyOwner }] });
    setError('');
    setModalOpen(true);
  }

  function openEdit(u: Unit) {
    setEditing(u);
    const owners = u.unit_owners && u.unit_owners.length > 0
      ? [...u.unit_owners]
          .sort((a, b) => a.position - b.position)
          .map(o => ({
            document_type: o.document_type,
            document_number: o.document_number,
            first_name: o.first_name,
            last_name: o.last_name,
            business_name: o.business_name,
            email: o.email,
            phone: o.phone,
            is_primary: o.is_primary,
          }))
      : [{ ...emptyOwner }];
    setForm({
      tower: u.tower,
      unit_label: u.unit_label,
      type: u.type,
      coefficient: String(u.coefficient),
      built_area: u.built_area ? String(u.built_area) : '',
      payment_reference: u.payment_reference || '',
      is_active: u.is_active,
      owners,
    });
    setError('');
    setModalOpen(true);
  }

  function updateOwner(idx: number, field: keyof OwnerFormState, value: string | boolean) {
    setForm(prev => {
      const owners = [...prev.owners];
      owners[idx] = { ...owners[idx], [field]: value };
      return { ...prev, owners };
    });
  }

  function addOwner() {
    if (form.owners.length >= 2) return;
    setForm(prev => ({
      ...prev,
      owners: [...prev.owners, { ...emptyOwner, is_primary: false }],
    }));
  }

  function removeOwner(idx: number) {
    if (form.owners.length <= 1) return;
    setForm(prev => {
      const owners = prev.owners.filter((_, i) => i !== idx);
      owners[0].is_primary = true;
      return { ...prev, owners };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    if (!activeOrg) return;

    const coef = parseFloat(form.coefficient) || 0;
    if (coef <= 0) {
      setError('El coeficiente de copropiedad debe ser mayor que cero.');
      setSaving(false);
      return;
    }
    if (!form.unit_label.trim()) {
      setError('La identificación de la unidad es obligatoria.');
      setSaving(false);
      return;
    }

    const isDuplicate = await checkDuplicateIdentifier(form.tower, form.unit_label, editing?.id);
    if (isDuplicate) {
      const identifier = buildUniqueIdentifier(form.tower, form.unit_label);
      setError(`Ya existe una unidad activa con el identificador "${identifier}". La combinación de Torre + Unidad debe ser única.`);
      setSaving(false);
      return;
    }

    const primaryOwner = form.owners[0];
    const ownerName = primaryOwner.business_name
      ? primaryOwner.business_name
      : `${primaryOwner.first_name} ${primaryOwner.last_name}`.trim();
    const ownerDoc = primaryOwner.document_number;
    const ownerPhone = primaryOwner.phone || form.owners.find(o => o.phone)?.phone || '';

    const unitPayload = {
      organization_id: activeOrg.id,
      tower: form.tower,
      unit_label: form.unit_label,
      type: form.type,
      coefficient: coef,
      built_area: form.built_area ? parseFloat(form.built_area) : null,
      payment_reference: form.payment_reference || null,
      owner_name: ownerName,
      owner_document: ownerDoc,
      owner_document_type: primaryOwner.document_type,
      owner_phone: ownerPhone,
      is_active: form.is_active,
    };

    try {
      let unitId: string;
      if (editing) {
        const { error: err } = await supabase.from('units').update(unitPayload).eq('id', editing.id);
        if (err) throw err;
        unitId = editing.id;
        await supabase.from('unit_owners').delete().eq('unit_id', unitId);
      } else {
        const { data: created, error: err } = await supabase.from('units').insert(unitPayload).select().single();
        if (err) throw err;
        unitId = created.id;
      }

      const ownerInserts = form.owners
        .filter(o => o.document_number.trim() || o.first_name.trim() || o.business_name.trim())
        .map((o, idx) => ({
          organization_id: activeOrg.id,
          unit_id: unitId,
          position: (idx + 1) as 1 | 2,
          document_type: o.document_type,
          document_number: o.document_number,
          first_name: o.first_name,
          last_name: o.last_name,
          business_name: o.business_name,
          email: o.email,
          phone: o.phone,
          is_primary: idx === 0,
        }));

      if (ownerInserts.length > 0) {
        const { error: oErr } = await supabase.from('unit_owners').insert(ownerInserts);
        if (oErr) throw oErr;
      }

      setSaving(false);
      setModalOpen(false);
      await loadItems();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar la unidad';
      setError(msg);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await supabase.from('units').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null);
    await loadItems();
  }

  // ============ EXCEL BULK UPLOAD ============

  function openUpload() {
    setUploadOpen(true);
    setParsedRows([]);
    setUploadErrors([]);
    setUploadValid(false);
    setUploadMsg('');
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    parseExcelFile(file);
  }

  function parseExcelFile(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) {
          setUploadMsg('El archivo no contiene hojas válidas.');
          setUploadValid(false);
          return;
        }
        const jsonRows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        validateRows(jsonRows);
      } catch {
        setUploadMsg('No se pudo leer el archivo. Verifique que sea un Excel válido (.xlsx, .xls).');
        setUploadValid(false);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function validateRows(rawRows: string[][]) {
    if (rawRows.length < 2) {
      setUploadMsg('El archivo no contiene filas de datos (solo encabezados o vacío).');
      setUploadValid(false);
      setParsedRows([]);
      setUploadErrors([]);
      return;
    }

    const headerRow = rawRows[0].map(h => String(h).trim());
    const colMap: Record<string, number> = {};
    EXPECTED_COLUMNS.forEach((expected) => {
      const idx = headerRow.findIndex(h => h.toLowerCase() === expected.toLowerCase());
      if (idx >= 0) colMap[expected] = idx;
    });

    const missingCols = EXPECTED_COLUMNS.filter(c => !(c in colMap));
    if (missingCols.length > 0) {
      setUploadMsg(`Faltan columnas obligatorias: ${missingCols.join(', ')}. Descargue la plantilla para ver el formato correcto.`);
      setUploadValid(false);
      setParsedRows([]);
      setUploadErrors([]);
      return;
    }

    const allErrors: CellError[] = [];
    const parsed: ParsedRow[] = [];

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (row.every(c => String(c).trim() === '')) continue;

      const rowNum = i + 1;
      const rowErrors: CellError[] = [];
      const rowData: Record<string, string> = {};

      EXPECTED_COLUMNS.forEach((colName, colIdx) => {
        const actualIdx = colMap[colName] ?? colIdx;
        const value = String(row[actualIdx] ?? '').trim();
        rowData[colName] = value;
      });

      if (!rowData['Unidad']) {
        const colIdx = colMap['Unidad'];
        rowErrors.push({ row: rowNum, col: colIdx, cellRef: `${colLetter(colIdx)}${rowNum}`, message: 'La identificación de la unidad es obligatoria' });
      }
      const coefStr = rowData['Coeficiente'];
      const coefNum = parseFloat(coefStr);
      if (!coefStr) {
        const colIdx = colMap['Coeficiente'];
        rowErrors.push({ row: rowNum, col: colIdx, cellRef: `${colLetter(colIdx)}${rowNum}`, message: 'El coeficiente es obligatorio' });
      } else if (isNaN(coefNum) || coefNum <= 0) {
        const colIdx = colMap['Coeficiente'];
        rowErrors.push({ row: rowNum, col: colIdx, cellRef: `${colLetter(colIdx)}${rowNum}`, message: `Celda ${colLetter(colIdx)}${rowNum}: Debe ser un valor numérico mayor que cero` });
      }

      const areaStr = rowData['Area Construida'];
      if (areaStr) {
        const areaNum = parseFloat(areaStr);
        if (isNaN(areaNum) || areaNum < 0) {
          const colIdx = colMap['Area Construida'];
          rowErrors.push({ row: rowNum, col: colIdx, cellRef: `${colLetter(colIdx)}${rowNum}`, message: `Celda ${colLetter(colIdx)}${rowNum}: Debe ser un valor numérico` });
        }
      }

      const tipoVal = rowData['Tipo'].toLowerCase();
      if (rowData['Tipo'] && !UNIT_TYPES.includes(tipoVal)) {
        const colIdx = colMap['Tipo'];
        rowErrors.push({ row: rowNum, col: colIdx, cellRef: `${colLetter(colIdx)}${rowNum}`, message: `Celda ${colLetter(colIdx)}${rowNum}: Tipo no válido. Valores permitidos: ${UNIT_TYPES.join(', ')}` });
      }

      const docType1 = rowData['Tipo Doc Prop 1'].toUpperCase();
      if (docType1 && !DOC_TYPES.includes(docType1)) {
        const colIdx = colMap['Tipo Doc Prop 1'];
        rowErrors.push({ row: rowNum, col: colIdx, cellRef: `${colLetter(colIdx)}${rowNum}`, message: `Celda ${colLetter(colIdx)}${rowNum}: Tipo de documento no válido. Use: ${DOC_TYPES.join(', ')}` });
      }
      if (!rowData['Documento Prop 1']) {
        const colIdx = colMap['Documento Prop 1'];
        rowErrors.push({ row: rowNum, col: colIdx, cellRef: `${colLetter(colIdx)}${rowNum}`, message: 'El documento del propietario 1 es obligatorio' });
      }
      if (!rowData['Nombres Prop 1'] && !rowData['Razon Social Prop 1']) {
        const colIdx = colMap['Nombres Prop 1'];
        rowErrors.push({ row: rowNum, col: colIdx, cellRef: `${colLetter(colIdx)}${rowNum}`, message: 'Debe ingresar nombres o razón social del propietario 1' });
      }

      const docType2 = rowData['Tipo Doc Prop 2'].toUpperCase();
      if (docType2 && !DOC_TYPES.includes(docType2)) {
        const colIdx = colMap['Tipo Doc Prop 2'];
        rowErrors.push({ row: rowNum, col: colIdx, cellRef: `${colLetter(colIdx)}${rowNum}`, message: `Celda ${colLetter(colIdx)}${rowNum}: Tipo de documento no válido. Use: ${DOC_TYPES.join(', ')}` });
      }
      if (rowData['Documento Prop 2'] && !rowData['Nombres Prop 2'] && !rowData['Razon Social Prop 2']) {
        const colIdx = colMap['Nombres Prop 2'];
        rowErrors.push({ row: rowNum, col: colIdx, cellRef: `${colLetter(colIdx)}${rowNum}`, message: 'El propietario 2 tiene documento pero falta nombre o razón social' });
      }

      allErrors.push(...rowErrors);
      parsed.push({ rowIndex: rowNum, data: rowData, errors: rowErrors });
    }

    const seenIdentifiers = new Set<string>();
    for (const r of parsed) {
      const identifier = buildUniqueIdentifier(r.data['Torre'] || '', r.data['Unidad']);
      if (seenIdentifiers.has(identifier)) {
        allErrors.push({
          row: r.rowIndex, col: colMap['Unidad'] ?? 1,
          cellRef: `${colLetter(colMap['Unidad'] ?? 1)}${r.rowIndex}`,
          message: `Identificador duplicado dentro del archivo: "${identifier}". La combinación Torre + Unidad debe ser única.`,
        });
        r.errors.push({
          row: r.rowIndex, col: colMap['Unidad'] ?? 1,
          cellRef: `${colLetter(colMap['Unidad'] ?? 1)}${r.rowIndex}`,
          message: `Identificador duplicado dentro del archivo: "${identifier}"`,
        });
      } else {
        seenIdentifiers.add(identifier);
      }
    }

    setParsedRows(parsed);
    setUploadErrors(allErrors);
    setUploadValid(allErrors.length === 0 && parsed.length > 0);
    if (parsed.length === 0) {
      setUploadMsg('No se encontraron filas con datos para importar.');
    } else if (allErrors.length === 0) {
      setUploadMsg(`${parsed.length} unidades validadas correctamente. Listo para importar.`);
    } else {
      setUploadMsg(`Se encontraron ${allErrors.length} errores en ${parsed.filter(r => r.errors.length > 0).length} fila(s). Corrija las celdas marcadas en rojo antes de importar.`);
    }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([EXPECTED_COLUMNS]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inmuebles');
    XLSX.writeFile(wb, 'plantilla_inmuebles.xlsx');
  }

  async function handleBulkImport() {
    if (!activeOrg || !uploadValid || parsedRows.length === 0) return;
    setUploading(true);
    setUploadMsg('');

    try {
      const incomingIdentifiers = parsedRows.map(r => buildUniqueIdentifier(r.data['Torre'] || '', r.data['Unidad']));
      const { data: existingUnits } = await supabase
        .from('units')
        .select('unique_identifier')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .in('unique_identifier', incomingIdentifiers);

      if (existingUnits && existingUnits.length > 0) {
        const dupes = existingUnits.map(u => u.unique_identifier).join(', ');
        setUploadMsg(`Identificadores duplicados contra unidades existentes: ${dupes}. Corrija el archivo e intente de nuevo.`);
        setUploadValid(false);
        setUploading(false);
        return;
      }
      const unitInserts = parsedRows.map(r => {
        const d = r.data;
        const tipo = d['Tipo'].toLowerCase() || 'apartamento';
        const coef = parseFloat(d['Coeficiente']) || 0;
        const area = d['Area Construida'] ? parseFloat(d['Area Construida']) : null;
        const owner1Name = d['Razon Social Prop 1'] || `${d['Nombres Prop 1']} ${d['Apellidos Prop 1']}`.trim();
        return {
          organization_id: activeOrg.id,
          tower: d['Torre'] || '',
          unit_label: d['Unidad'],
          type: UNIT_TYPES.includes(tipo) ? tipo : 'apartamento',
          coefficient: coef,
          built_area: area,
          payment_reference: d['Referencia de Pago'] || null,
          owner_name: owner1Name,
          owner_document: d['Documento Prop 1'] || '',
          owner_document_type: d['Tipo Doc Prop 1'].toUpperCase(),
          owner_phone: d['Telefono Prop 1'] || '',
          is_active: true,
        };
      });

      const { data: createdUnits, error: uErr } = await supabase
        .from('units')
        .insert(unitInserts)
        .select();
      if (uErr) throw uErr;

      const ownerInserts: Array<{
        organization_id: string;
        unit_id: string;
        position: 1 | 2;
        document_type: string;
        document_number: string;
        first_name: string;
        last_name: string;
        business_name: string;
        email: string;
        phone: string;
        is_primary: boolean;
      }> = [];

      createdUnits.forEach((unit, idx) => {
        const d = parsedRows[idx].data;
        ownerInserts.push({
          organization_id: activeOrg.id,
          unit_id: unit.id,
          position: 1,
          document_type: d['Tipo Doc Prop 1'].toUpperCase() || 'CC',
          document_number: d['Documento Prop 1'] || '',
          first_name: d['Nombres Prop 1'] || '',
          last_name: d['Apellidos Prop 1'] || '',
          business_name: d['Razon Social Prop 1'] || '',
          email: d['Email Prop 1'] || '',
          phone: d['Telefono Prop 1'] || '',
          is_primary: true,
        });
        if (d['Documento Prop 2'] || d['Nombres Prop 2'] || d['Razon Social Prop 2']) {
          ownerInserts.push({
            organization_id: activeOrg.id,
            unit_id: unit.id,
            position: 2,
            document_type: d['Tipo Doc Prop 2'].toUpperCase() || 'CC',
            document_number: d['Documento Prop 2'] || '',
            first_name: d['Nombres Prop 2'] || '',
            last_name: d['Apellidos Prop 2'] || '',
            business_name: d['Razon Social Prop 2'] || '',
            email: d['Email Prop 2'] || '',
            phone: d['Telefono Prop 2'] || '',
            is_primary: false,
          });
        }
      });

      if (ownerInserts.length > 0) {
        const { error: oErr } = await supabase.from('unit_owners').insert(ownerInserts);
        if (oErr) throw oErr;
      }

      setUploadMsg(`Se importaron ${createdUnits.length} unidades correctamente.`);
      setUploadValid(false);
      setParsedRows([]);
      setUploading(false);
      await loadItems();
      setTimeout(() => setUploadOpen(false), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al importar las unidades';
      setUploadMsg(msg);
      setUploading(false);
    }
  }

  if (!activeOrg) return <NoOrgSelected />;

  const totalCoeff = items.reduce((s, u) => s + u.coefficient, 0);
  const errorCells = new Set(uploadErrors.map(e => e.cellRef));

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inmuebles / Unidades</h1>
          <p className="text-gray-500 mt-1">Unidades privadas de propiedad horizontal y copropietarios</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openUpload}><Upload className="w-4 h-4" /> Carga Masiva</Button>
          <Button onClick={openCreate}><Plus className="w-4 h-4" /> Nueva Unidad</Button>
        </div>
      </div>

      {items.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-4">
          <div className="px-4 py-2 rounded-lg bg-gray-100 text-sm text-gray-700">Total unidades: <strong>{items.length}</strong></div>
          <div className="px-4 py-2 rounded-lg bg-gray-100 text-sm text-gray-700">Suma coeficientes: <strong>{formatNumber(totalCoeff, 4)}</strong></div>
        </div>
      )}

      <div className="mb-5 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar por torre, unidad o propietario..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-auto">
            <option value="all">Todos los tipos</option>
            {Object.entries(unitTypeLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-auto">
            <option value="all">Todos los estados</option>
            <option value="active">Activas</option>
            <option value="inactive">Inactivas</option>
          </Select>
          <Select value={filterTower} onChange={(e) => setFilterTower(e.target.value)} className="w-auto">
            <option value="all">Todas las torres</option>
            {towers.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
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
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Área m²</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Propietario(s)</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Acciones</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">{u.unit_label}</p>
                      <p className="text-xs text-gray-500">Torre: {u.tower || 'N/A'}</p>
                      <p className="text-xs text-gray-400 font-mono">ID: {u.unique_identifier || `${u.tower || ''}-${u.unit_label}`.toUpperCase()}</p>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell"><Badge variant="blue">{unitTypeLabels[u.type]}</Badge></td>
                    <td className="px-6 py-4 text-right text-sm text-gray-700">{formatNumber(u.coefficient, 4)}</td>
                    <td className="px-6 py-4 text-right text-sm text-gray-700 hidden lg:table-cell">{u.built_area ? formatNumber(u.built_area, 2) : 'N/A'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden lg:table-cell">
                      {u.unit_owners && u.unit_owners.length > 0 ? (
                        <div className="space-y-1">
                          {u.unit_owners.map(o => (
                            <div key={o.id} className="flex items-center gap-1.5">
                              <Users className="w-3 h-3 text-gray-400" />
                              <span>{o.business_name || `${o.first_name} ${o.last_name}`.trim() || 'Sin nombre'}</span>
                              {o.is_primary && <Badge variant="gray">Principal</Badge>}
                            </div>
                          ))}
                        </div>
                      ) : (u.owner_name || 'N/A')}
                    </td>
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

      {/* Modal: Crear/Editar Unidad */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Unidad' : 'Nueva Unidad'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Datos de la Unidad</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Torre / Bloque" value={form.tower} onChange={(e) => setForm({ ...form, tower: e.target.value })} placeholder="Ej: Torre 1" />
              <Input label="Identificación de Unidad *" value={form.unit_label} onChange={(e) => setForm({ ...form, unit_label: e.target.value })} required placeholder="Ej: Apto 101" />
              <Select label="Tipo" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(unitTypeLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Input label="Coeficiente de Copropiedad *" type="number" step="0.000001" value={form.coefficient} onChange={(e) => setForm({ ...form, coefficient: e.target.value })} required placeholder="Ej: 0.025000" />
              <Input label="Área Construida (m²)" type="number" step="0.01" value={form.built_area} onChange={(e) => setForm({ ...form, built_area: e.target.value })} placeholder="Ej: 85.50" />
              <Input label="Referencia de Pago" value={form.payment_reference} onChange={(e) => setForm({ ...form, payment_reference: e.target.value })} placeholder="Ej: REF-101" />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700">Unidad activa</span>
          </label>

          {/* Propietarios */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Users className="w-4 h-4" /> Copropietarios (máx. 2)</h3>
              {form.owners.length < 2 && (
                <Button type="button" variant="outline" size="sm" onClick={addOwner}><Plus className="w-3 h-3" /> Agregar Copropietario</Button>
              )}
            </div>
            <div className="space-y-4">
              {form.owners.map((owner, idx) => (
                <div key={idx} className="rounded-lg border border-gray-200 p-4 bg-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-gray-600 uppercase">Propietario {idx + 1} {idx === 0 && '(Principal)'}</span>
                    {form.owners.length > 1 && (
                      <button type="button" onClick={() => removeOwner(idx)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Select label="Tipo de Documento" value={owner.document_type} onChange={(e) => updateOwner(idx, 'document_type', e.target.value)}>
                      {Object.entries(documentTypeLabelsPH).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                    <Input label="Número de Documento" value={owner.document_number} onChange={(e) => updateOwner(idx, 'document_number', e.target.value)} placeholder="Ej: 1234567890" />
                    <Input label="Nombres" value={owner.first_name} onChange={(e) => updateOwner(idx, 'first_name', e.target.value)} placeholder="Nombres (persona natural)" />
                    <Input label="Apellidos" value={owner.last_name} onChange={(e) => updateOwner(idx, 'last_name', e.target.value)} placeholder="Apellidos (persona natural)" />
                    <div className="sm:col-span-2">
                      <Input label="Razón Social" value={owner.business_name} onChange={(e) => updateOwner(idx, 'business_name', e.target.value)} placeholder="Razón social (persona jurídica, opcional)" />
                    </div>
                    <Input label="Correo Electrónico" type="email" value={owner.email} onChange={(e) => updateOwner(idx, 'email', e.target.value)} placeholder="correo@ejemplo.com" />
                    <Input label="Teléfono" value={owner.phone} onChange={(e) => updateOwner(idx, 'phone', e.target.value)} placeholder="Ej: 3001234567" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Carga Masiva Excel */}
      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Carga Masiva de Inmuebles" size="lg">
        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
            <p className="text-sm text-blue-800">
              Descargue la plantilla, complete los datos de cada unidad y suba el archivo.
              La validación resaltará las celdas con errores antes de importar.
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={downloadTemplate}>
              <FileSpreadsheet className="w-4 h-4" /> Descargar Plantilla
            </Button>
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelect} />
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-600 mb-2">Seleccione un archivo Excel (.xlsx, .xls)</p>
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              Seleccionar Archivo
            </Button>
          </div>

          {uploadMsg && (
            <div className={`rounded-lg border px-4 py-3 ${uploadValid ? 'bg-green-50 border-green-200' : uploadErrors.length > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
              <p className={`text-sm flex items-center gap-2 ${uploadValid ? 'text-green-800' : uploadErrors.length > 0 ? 'text-red-700' : 'text-gray-700'}`}>
                {uploadValid ? <CheckCircle2 className="w-4 h-4" /> : uploadErrors.length > 0 ? <AlertTriangle className="w-4 h-4" /> : null}
                {uploadMsg}
              </p>
            </div>
          )}

          {parsedRows.length > 0 && (
            <div className="overflow-x-auto max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    {EXPECTED_COLUMNS.map((col) => (
                      <th key={col} className="text-left font-semibold text-gray-600 px-3 py-2 whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {parsedRows.map((row) => (
                    <tr key={row.rowIndex}>
                      {EXPECTED_COLUMNS.map((col, colIdx) => {
                        const cellRef = `${colLetter(colIdx)}${row.rowIndex}`;
                        const hasError = errorCells.has(cellRef);
                        const value = row.data[col] || '';
                        return (
                          <td key={col} className={`px-3 py-2 ${hasError ? 'bg-red-100 text-red-800 font-medium' : 'text-gray-700'}`}>
                            {value}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {uploadErrors.length > 0 && (
            <div className="max-h-40 overflow-y-auto border border-red-200 rounded-lg bg-red-50 p-3">
              <p className="text-xs font-semibold text-red-700 mb-2">Errores detectados ({uploadErrors.length}):</p>
              <ul className="space-y-1">
                {uploadErrors.map((err, idx) => (
                  <li key={idx} className="text-xs text-red-600">
                    <strong>Celda {err.cellRef}:</strong> {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setUploadOpen(false)}>Cancelar</Button>
            <Button type="button" disabled={!uploadValid || uploading} onClick={handleBulkImport}>
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Importando...</> : 'Importar Unidades'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar Unidad" size="sm">
        <p className="text-sm text-gray-600 mb-4">¿Eliminar la unidad <strong>{deleteTarget?.unit_label}</strong>? Se eliminarán también los copropietarios y cuotas asociadas.</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Sí, Eliminar</Button>
        </div>
      </Modal>
    </div>
  );
}