import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import {
  supabase,
  Due,
  PaymentHierarchyConfig,
  Unit,
  BillingConcept,
} from '@/lib/supabase';
import { formatCOP } from '@/lib/format';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { NoOrgSelected } from '@/components/shared';
import {
  buildDetailedDueItems,
  allocateReceipt,
  roundMoney,
} from '@/components/treasury/receiptAllocation';

interface ValidationErrorItem {
  rowNumber: number;
  field: string;
  message: string;
}

interface PreviewAllocationRow {
  due_id: string;
  concept_id: string;
  concept_code: string;
  concept_name: string;
  period: string;
  capital_applied: number;
  interest_applied: number;
  discount_applied: number;
}

interface PreviewReceiptItem {
  rowNumber: number;
  projectedReceiptNumber: string;
  unitId: string;
  unitLabel: string;
  paymentMethodId: string;
  paymentMethodName: string;
  paymentDate: string;
  accountingDate: string;
  totalAmount: number;
  appliedAmount: number;
  discountAmount: number;
  advanceAmount: number;
  advanceConceptId: string | null;
  advanceConceptLabel: string;
  notes: string;
  allocations: PreviewAllocationRow[];
}

interface CreatedReceiptSummary {
  rowNumber: number;
  receiptNumber: string;
  unitLabel: string;
  totalAmount: number;
}

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsvText(text: string): Record<string, string>[] {
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length < 2) return [];

  const firstLine = lines[0];
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const headers = parseCsvLine(firstLine, delimiter).map(normalizeKey);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter);
    const rowObj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) {
        rowObj[h] = (values[idx] ?? '').trim();
      }
    });
    const hasAnyValue = Object.values(rowObj).some(v => v !== '');
    if (hasAnyValue) {
      rows.push(rowObj);
    }
  }
  return rows;
}

function pickField(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') {
      return row[k];
    }
  }
  return '';
}

function parseNumberStrict(raw: string): number {
  if (!raw) return NaN;
  const cleaned = raw.replace(/\s+/g, '').replace(/\$/g, '');
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned)) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  if (/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(cleaned)) {
    return Number(cleaned.replace(/,/g, ''));
  }
  return Number(cleaned.replace(',', '.'));
}

function unitDisplay(unit: any): string {
  if (unit.unique_identifier) {
    return unit.tower
      ? `${unit.unique_identifier} (Torre ${unit.tower} · ${unit.unit_label})`
      : `${unit.unique_identifier} (${unit.unit_label})`;
  }
  return unit.tower ? `Torre ${unit.tower} · ${unit.unit_label}` : unit.unit_label;
}

function isOrderClass(accountClass?: string | null): boolean {
  const val = String(accountClass || '').toLowerCase().trim();
  return val === 'orden' || val === 'cuentas_de_orden' || val === 'order';
}

export function BulkReceiptUpload() {
  const { activeOrg } = useOrg();

  const [loadingRef, setLoadingRef] = useState(true);
  const [refError, setRefError] = useState('');
  const [units, setUnits] = useState<any[]>([]);
  const [methods, setMethods] = useState<any[]>([]);
  const [hierarchy, setHierarchy] = useState<PaymentHierarchyConfig[]>([]);
  const [concepts, setConcepts] = useState<any[]>([]);
  const [advancePriorityIds, setAdvancePriorityIds] = useState<string[]>([]);
  const [discountTiers, setDiscountTiers] = useState<any[]>([]);
  const [activePeriod, setActivePeriod] = useState<{ start_date: string; end_date: string; name: string } | null>(null);
  const [nextSeq, setNextSeq] = useState<number>(1);

  const [fileName, setFileName] = useState<string>('');
  const [validating, setValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrorItem[]>([]);
  const [previewItems, setPreviewItems] = useState<PreviewReceiptItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [createdSummary, setCreatedSummary] = useState<CreatedReceiptSummary[]>([]);

  const loadReference = useCallback(async () => {
    if (!activeOrg) return;
    setLoadingRef(true);
    setRefError('');

    const [unitsRes, methodsRes, hierarchyRes, conceptsRes, discountsRes, periodRes, docRes] = await Promise.all([
      supabase
        .from('units')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('tower', { ascending: true })
        .order('unit_label', { ascending: true }),
      supabase
        .from('payment_methods')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('payment_hierarchy_configs')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .order('priority_order', { ascending: true }),
      supabase
        .from('billing_concepts')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('discount_tiers')
        .select('*')
        .eq('organization_id', activeOrg.id),
      supabase
        .from('revenue_periods')
        .select('start_date, end_date, name')
        .eq('organization_id', activeOrg.id)
        .eq('is_work_period_active', true)
        .maybeSingle(),
      supabase
        .from('accounting_documents')
        .select('next_consecutive')
        .eq('organization_id', activeOrg.id)
        .eq('prefix', 'RC')
        .maybeSingle(),
    ]);

    if (unitsRes.error || methodsRes.error || hierarchyRes.error || conceptsRes.error) {
      setRefError('No se pudieron cargar los datos de referencia para el cargue masivo.');
      setLoadingRef(false);
      return;
    }

    const loadedConcepts = conceptsRes.data || [];
    const eligibleAdvance = loadedConcepts.filter((c: any) => !c.is_late_interest && c.advance_account_id);

    setUnits(unitsRes.data || []);
    setMethods(methodsRes.data || []);
    setHierarchy((hierarchyRes.data || []) as PaymentHierarchyConfig[]);
    setConcepts(loadedConcepts);
    setAdvancePriorityIds(prev => {
      const eligibleIds = eligibleAdvance.map((c: any) => String(c.id));
      const kept = prev.filter(id => eligibleIds.includes(id));
      const added = eligibleIds.filter(id => !kept.includes(id));
      return [...kept, ...added];
    });
    setDiscountTiers(discountsRes.data || []);
    setActivePeriod(periodRes.data || null);
    setNextSeq(Number(docRes.data?.next_consecutive || 1));
    setLoadingRef(false);
  }, [activeOrg]);

  useEffect(() => {
    loadReference();
  }, [loadReference]);

  const orderedAdvanceConcepts = useMemo(() => {
    const eligibleMap = new Map<string, any>();
    concepts
      .filter((c: any) => !c.is_late_interest && c.advance_account_id)
      .forEach((c: any) => eligibleMap.set(String(c.id), c));

    const result: any[] = [];
    advancePriorityIds.forEach(id => {
      const found = eligibleMap.get(id);
      if (found) {
        result.push(found);
        eligibleMap.delete(id);
      }
    });
    eligibleMap.forEach(c => result.push(c));
    return result;
  }, [concepts, advancePriorityIds]);

  function moveAdvancePriority(index: number, direction: 'up' | 'down') {
    const list = orderedAdvanceConcepts.map(c => String(c.id));
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const copy = [...list];
    const temp = copy[index];
    copy[index] = copy[targetIdx];
    copy[targetIdx] = temp;
    setAdvancePriorityIds(copy);
  }

  function handleDownloadTemplate() {
    const sampleUnit = units[0]?.unique_identifier || (units[0] ? unitDisplay(units[0]) : '1-101');
    const sampleMethod = methods[0]?.name || 'Consignación';
    const startDate = activePeriod?.start_date || '2026-11-01';
    const csvContent = [
      'unidad,metodo_pago,valor_recibido,fecha_pago,fecha_contable,notas',
      `"${sampleUnit}","${sampleMethod}",150000,"${startDate}","${startDate}","Cargue masivo inicial"`,
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'plantilla_cargue_masivo_recibos.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function extractRowsFromFile(file: File): Promise<Record<string, string>[]> {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const xlsxMod: any = await import('xlsx');
      const XLSX = xlsxMod?.default || xlsxMod;
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) return [];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawJson: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
      return rawJson
        .map(obj => {
          const normalizedRow: Record<string, string> = {};
          Object.entries(obj).forEach(([k, v]) => {
            const nk = normalizeKey(String(k));
            if (nk) normalizedRow[nk] = String(v ?? '').trim();
          });
          return normalizedRow;
        })
        .filter(r => Object.values(r).some(v => v !== ''));
    }

    const text = await file.text();
    return parseCsvText(text);
  }

  function findMatchingUnit(rawUnit: string, rawTower: string = '', rawUnitLabel: string = ''): any | undefined {
    const target = rawUnit.toLowerCase().trim().replace(/\s+/g, ' ');
    const towerClean = rawTower.toLowerCase().trim().replace(/^torre\s*/i, '').replace(/\s+/g, '');
    const labelClean = rawUnitLabel.toLowerCase().trim().replace(/\s+/g, '');

    if (towerClean && labelClean) {
      const byTowerAndLabel = units.find(u => {
        const uTower = String(u.tower || '').toLowerCase().trim().replace(/^torre\s*/i, '').replace(/\s+/g, '');
        const uLabel = String(u.unit_label || '').toLowerCase().trim().replace(/\s+/g, '');
        return uTower === towerClean && uLabel === labelClean;
      });
      if (byTowerAndLabel) return byTowerAndLabel;
    }

    if (!target) return undefined;

    // 1. Coincidencia por unique_identifier (ej. "1-101")
    const byUniqueId = units.find(u =>
      String(u.unique_identifier || '').toLowerCase().trim().replace(/\s+/g, ' ') === target
    );
    if (byUniqueId) return byUniqueId;

    // 2. Respaldo por combinación de tower y unit_label (ej. "1-101", "1 101", "Torre 1 · 101", "Torre 1 - 101")
    const compactTarget = target.replace(/[^a-z0-9]/g, '');
    const byTowerAndUnitLabel = units.find(u => {
      const uTower = String(u.tower || '').toLowerCase().trim().replace(/^torre\s*/i, '').replace(/[^a-z0-9]/g, '');
      const uLabel = String(u.unit_label || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
      const combinedCompact = `${uTower}${uLabel}`;
      const combinedDash = `${String(u.tower || '').toLowerCase().trim()}-${String(u.unit_label || '').toLowerCase().trim()}`;
      const fullLabel = (u.tower ? `torre ${u.tower} · ${u.unit_label}` : String(u.unit_label || ''))
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
      const plainLabel = String(u.unit_label || '').toLowerCase().trim().replace(/\s+/g, ' ');

      return (
        (combinedCompact && combinedCompact === compactTarget) ||
        combinedDash === target ||
        fullLabel === target ||
        plainLabel === target ||
        String(u.id || '').toLowerCase() === target
      );
    });

    return byTowerAndUnitLabel;
  }

  function findMatchingMethod(rawMethod: string): any | undefined {
    const target = rawMethod.toLowerCase().trim();
    if (!target) return undefined;
    return methods.find(m =>
      String(m.name || '').toLowerCase().trim() === target ||
      String(m.id || '').toLowerCase() === target
    );
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeOrg) return;

    setFileName(file.name);
    setValidating(true);
    setValidationErrors([]);
    setPreviewItems([]);
    setSaveError('');
    setCreatedSummary([]);

    const errors: ValidationErrorItem[] = [];
    const previews: PreviewReceiptItem[] = [];

    try {
      if (!activePeriod) {
        errors.push({
          rowNumber: 0,
          field: 'periodo_trabajo',
          message: 'No hay un periodo de trabajo activo configurado en el Calendario de Recaudo.',
        });
      }

      const rows = await extractRowsFromFile(file);
      if (rows.length === 0) {
        errors.push({
          rowNumber: 0,
          field: 'archivo',
          message: 'El archivo está vacío o no tiene filas de datos válidas.',
        });
      }

      const unitIdsNeeded = Array.from(
        new Set(
          rows
            .map(r =>
              findMatchingUnit(
                pickField(r, ['unidad', 'unique_identifier', 'unit', 'unidad_label', 'inmueble', 'apto']),
                pickField(r, ['tower', 'torre']),
                pickField(r, ['unit_label', 'numero_unidad', 'unidad_numero'])
              )
            )
            .filter(Boolean)
            .map(u => (u as Unit).id)
        )
      );

      const duesByUnit = new Map<string, Due[]>();
      const invoicesByUnit = new Map<string, Record<string, any>>();

      if (unitIdsNeeded.length > 0) {
        const [duesRes, invRes] = await Promise.all([
          supabase
            .from('dues')
            .select('*')
            .eq('organization_id', activeOrg.id)
            .in('unit_id', unitIdsNeeded)
            .gt('balance', 0)
            .order('due_date', { ascending: true }),
          supabase
            .from('invoices')
            .select('*')
            .eq('organization_id', activeOrg.id)
            .in('unit_id', unitIdsNeeded),
        ]);

        (duesRes.data || []).forEach((d: any) => {
          const list = duesByUnit.get(d.unit_id) || [];
          list.push(d as Due);
          duesByUnit.set(d.unit_id, list);
        });

        (invRes.data || []).forEach((inv: any) => {
          const map = invoicesByUnit.get(inv.unit_id) || {};
          map[inv.unit_id + '_' + inv.period] = inv;
          map[inv.id] = inv;
          invoicesByUnit.set(inv.unit_id, map);
        });
      }

      const conceptById = new Map<string, any>();
      concepts.forEach(c => conceptById.set(String(c.id), c));

      const primaryAdvanceConcept = orderedAdvanceConcepts[0] || null;

      let seqCursor = nextSeq;

      rows.forEach((row, idx) => {
        const rowNumber = idx + 2;
        const rawUnit = pickField(row, ['unidad', 'unique_identifier', 'unit', 'unidad_label', 'inmueble', 'apto']);
        const rawTower = pickField(row, ['tower', 'torre']);
        const rawUnitLabel = pickField(row, ['unit_label', 'numero_unidad', 'unidad_numero']);
        const rawMethod = pickField(row, ['metodo_pago', 'metodo', 'payment_method', 'forma_pago']);
        const rawTotal = pickField(row, ['valor_recibido', 'valor', 'total', 'total_amount', 'monto']);
        const rawPayDate = pickField(row, ['fecha_pago', 'payment_date', 'fecha']);
        const rawAccDate = pickField(row, ['fecha_contable', 'accounting_date', 'fecha_contabilizacion']);
        const rawNotes = pickField(row, ['notas', 'notes', 'observacion', 'observaciones', 'detalle']);

        const matchedUnit = findMatchingUnit(rawUnit, rawTower, rawUnitLabel);
        if (!rawUnit && !rawTower && !rawUnitLabel) {
          errors.push({ rowNumber, field: 'unidad', message: 'La unidad es obligatoria.' });
        } else if (!matchedUnit) {
          errors.push({
            rowNumber,
            field: 'unidad',
            message: `La unidad "${rawUnit || `${rawTower}-${rawUnitLabel}`}" no coincide con ningún inmueble activo (unique_identifier / tower + unit_label).`,
          });
        }

        const matchedMethod = findMatchingMethod(rawMethod);
        if (!rawMethod) {
          errors.push({ rowNumber, field: 'metodo_pago', message: 'El método de pago es obligatorio.' });
        } else if (!matchedMethod) {
          errors.push({ rowNumber, field: 'metodo_pago', message: `El método de pago "${rawMethod}" no existe o está inactivo.` });
        } else if (!matchedMethod.account_id) {
          errors.push({ rowNumber, field: 'metodo_pago', message: `El método de pago "${matchedMethod.name}" no tiene cuenta contable asociada.` });
        }

        const totalAmount = parseNumberStrict(rawTotal);
        if (!rawTotal || !Number.isFinite(totalAmount) || totalAmount <= 0) {
          errors.push({ rowNumber, field: 'valor_recibido', message: 'El valor recibido debe ser un número mayor a cero.' });
        }

        const paymentDate = rawPayDate || activePeriod?.start_date || '';
        const accountingDate = rawAccDate || paymentDate;

        const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!isoDateRegex.test(paymentDate)) {
          errors.push({ rowNumber, field: 'fecha_pago', message: `Fecha de pago inválida ("${rawPayDate}"). Use formato YYYY-MM-DD.` });
        } else if (activePeriod && (paymentDate < activePeriod.start_date || paymentDate > activePeriod.end_date)) {
          errors.push({
            rowNumber,
            field: 'fecha_pago',
            message: `Fecha de pago (${paymentDate}) fuera del periodo activo (${activePeriod.name}: ${activePeriod.start_date} a ${activePeriod.end_date}).`,
          });
        }

        if (!isoDateRegex.test(accountingDate)) {
          errors.push({ rowNumber, field: 'fecha_contable', message: `Fecha contable inválida ("${rawAccDate}"). Use formato YYYY-MM-DD.` });
        } else if (activePeriod && (accountingDate < activePeriod.start_date || accountingDate > activePeriod.end_date)) {
          errors.push({
            rowNumber,
            field: 'fecha_contable',
            message: `Fecha contable (${accountingDate}) fuera del periodo activo (${activePeriod.name}: ${activePeriod.start_date} a ${activePeriod.end_date}).`,
          });
        }

        if (!matchedUnit || !matchedMethod || !Number.isFinite(totalAmount) || totalAmount <= 0 || !isoDateRegex.test(paymentDate) || !isoDateRegex.test(accountingDate)) {
          return;
        }

        const unitDues = duesByUnit.get(matchedUnit.id) || [];
        const unitInvMap = invoicesByUnit.get(matchedUnit.id) || {};

        const detailedItems = buildDetailedDueItems(
          unitDues,
          hierarchy,
          concepts as BillingConcept[],
          unitInvMap,
          discountTiers,
          paymentDate,
          totalAmount
        );

        const allocRes = allocateReceipt(detailedItems, totalAmount);

        const allocations: PreviewAllocationRow[] = [];
        let appliedSum = 0;
        let discountSum = 0;

        detailedItems.forEach(item => {
          const appliedVal = roundMoney(allocRes.amounts[item.id]?.applied || 0);
          const discountVal = roundMoney(item.discountAmount || 0);
          if (appliedVal > 0 || discountVal > 0) {
            const conceptObj = conceptById.get(String(item.conceptId));
            if (!conceptObj) {
              errors.push({
                rowNumber,
                field: 'concepto',
                message: `No se encontró el concepto "${item.conceptName}" en la parametrización activa.`,
              });
              return;
            }

            if (!conceptObj.income_account_id || !conceptObj.counterpart_account_id) {
              errors.push({
                rowNumber,
                field: 'cuentas_concepto',
                message: `El concepto "${conceptObj.name}" debe tener income_account_id y counterpart_account_id configurados.`,
              });
            }

            if (discountVal > 0 && !conceptObj.discount_income_account_id) {
              errors.push({
                rowNumber,
                field: 'cuenta_descuento',
                message: `El concepto "${conceptObj.name}" aplica descuento pero no tiene discount_income_account_id configurado.`,
              });
            }

            if (isOrderClass(conceptObj.account_class) && !conceptObj.third_account_id) {
              errors.push({
                rowNumber,
                field: 'cuenta_orden',
                message: `El concepto "${conceptObj.name}" es de clase orden y requiere third_account_id configurado.`,
              });
            }

            allocations.push({
              due_id: item.dueId,
              concept_id: item.conceptId,
              concept_code: item.conceptCode,
              concept_name: item.conceptName,
              period: item.period,
              capital_applied: item.isInterest ? 0 : appliedVal,
              interest_applied: item.isInterest ? appliedVal : 0,
              discount_applied: discountVal,
            });

            appliedSum = roundMoney(appliedSum + appliedVal);
            discountSum = roundMoney(discountSum + discountVal);
          }
        });

        const advanceAmount = roundMoney(Math.max(totalAmount - appliedSum, 0));
        let advanceConceptId: string | null = null;
        let advanceConceptLabel = '—';

        if (advanceAmount > 0) {
          if (!primaryAdvanceConcept) {
            errors.push({
              rowNumber,
              field: 'prelacion_anticipos',
              message: `El pago genera un anticipo de ${formatCOP(advanceAmount)} pero no hay ningún concepto en la Prelación de Anticipos con advance_account_id configurado.`,
            });
          } else if (!primaryAdvanceConcept.advance_account_id) {
            errors.push({
              rowNumber,
              field: 'prelacion_anticipos',
              message: `El concepto prioritario de anticipo "${primaryAdvanceConcept.name}" no tiene advance_account_id parametrizado.`,
            });
          } else {
            advanceConceptId = primaryAdvanceConcept.id;
            advanceConceptLabel = `${primaryAdvanceConcept.code} — ${primaryAdvanceConcept.name}`;
          }
        }

        const projectedReceiptNumber = `RC-${String(seqCursor).padStart(4, '0')}`;
        seqCursor += 1;

        previews.push({
          rowNumber,
          projectedReceiptNumber,
          unitId: matchedUnit.id,
          unitLabel: unitDisplay(matchedUnit),
          paymentMethodId: matchedMethod.id,
          paymentMethodName: matchedMethod.name,
          paymentDate,
          accountingDate,
          totalAmount: roundMoney(totalAmount),
          appliedAmount: appliedSum,
          discountAmount: discountSum,
          advanceAmount,
          advanceConceptId,
          advanceConceptLabel,
          notes: rawNotes,
          allocations,
        });
      });

      if (errors.length === 0) {
        setPreviewItems(previews);
      } else {
        setValidationErrors(errors);
        setPreviewItems([]);
      }
    } catch (err: any) {
      setValidationErrors([
        {
          rowNumber: 0,
          field: 'archivo',
          message: err?.message || 'Error al leer o procesar el archivo cargado.',
        },
      ]);
      setPreviewItems([]);
    } finally {
      setValidating(false);
      e.target.value = '';
    }
  }

  async function handleConfirmBulkSave() {
    if (!activeOrg || previewItems.length === 0 || validationErrors.length > 0) return;

    setSaving(true);
    setSaveError('');
    setCreatedSummary([]);

    const created: CreatedReceiptSummary[] = [];

    try {
      for (const item of previewItems) {
        const { data, error } = await supabase.rpc('save_receipt', {
          p_organization_id: activeOrg.id,
          p_unit_id: item.unitId,
          p_payment_date: item.paymentDate,
          p_accounting_date: item.accountingDate,
          p_payment_method_id: item.paymentMethodId,
          p_total_amount: item.totalAmount,
          p_notes: item.notes,
          p_allocations: item.allocations.map(a => ({
            due_id: a.due_id,
            concept_id: a.concept_id,
            capital_applied: a.capital_applied,
            interest_applied: a.interest_applied,
            discount_applied: a.discount_applied,
          })),
          p_advance_concept_id: item.advanceAmount > 0 ? item.advanceConceptId : null,
          p_advance_amount: item.advanceAmount > 0 ? item.advanceAmount : 0,
        });

        if (error || !(data as any)?.receipt_number) {
          throw new Error(
            `Fila ${item.rowNumber} (${item.unitLabel}): ${error?.message || (data as any)?.message || 'No se pudo guardar el recibo.'}`
          );
        }

        created.push({
          rowNumber: item.rowNumber,
          receiptNumber: (data as any).receipt_number,
          unitLabel: item.unitLabel,
          totalAmount: item.totalAmount,
        });
      }

      setCreatedSummary(created);
      setPreviewItems([]);
      setFileName('');
      await loadReference();
    } catch (err: any) {
      setSaveError(err?.message || 'Ocurrió un error durante el cargue masivo.');
    } finally {
      setSaving(false);
    }
  }

  if (!activeOrg) return <NoOrgSelected />;

  if (loadingRef) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (refError) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-600" />
        <p className="text-sm text-red-700">{refError}</p>
      </div>
    );
  }

  const totalPreviewAmount = roundMoney(previewItems.reduce((acc, r) => acc + r.totalAmount, 0));
  const totalPreviewApplied = roundMoney(previewItems.reduce((acc, r) => acc + r.appliedAmount, 0));
  const totalPreviewAdvance = roundMoney(previewItems.reduce((acc, r) => acc + r.advanceAmount, 0));

  return (
    <div className="space-y-6">
      <Card>
        <div className="p-6 flex flex-wrap items-center justify-between gap-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Cargue Masivo de Recibos de Caja</h2>
            <p className="text-sm text-gray-500">
              Identifica unidades por <span className="font-mono text-gray-700">unique_identifier</span> (con respaldo en <span className="font-mono text-gray-700">tower</span> y <span className="font-mono text-gray-700">unit_label</span>) y valida período, cuentas, consecutivos y prelación de pagos.
            </p>
            {activePeriod ? (
              <p className="text-xs text-blue-700 font-medium mt-1">
                Período activo: {activePeriod.name} ({activePeriod.start_date} a {activePeriod.end_date}) · Próximo consecutivo estimado: RC-{String(nextSeq).padStart(4, '0')}
              </p>
            ) : (
              <p className="text-xs text-red-700 font-medium mt-1">
                Sin período de trabajo activo configurado en el Calendario de Recaudo.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleDownloadTemplate}>
              <Download className="w-4 h-4 mr-1" /> Descargar plantilla CSV
            </Button>
            <label className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              <span>{validating ? 'Validando...' : 'Cargar archivo'}</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                disabled={validating || saving}
                className="hidden"
              />
            </label>
          </div>
        </div>

        <div className="p-6 bg-gray-50/60 text-xs text-gray-600 space-y-1.5">
          <p className="font-semibold text-gray-800 flex items-center gap-1.5">
            <FileSpreadsheet className="w-4 h-4 text-blue-600" /> Columnas esperadas en la plantilla:
          </p>
          <p className="font-mono bg-white border border-gray-200 rounded px-3 py-2 text-gray-800">
            unidad, metodo_pago, valor_recibido, fecha_pago, fecha_contable, notas
          </p>
          <p className="text-gray-600">
            <strong>unidad:</strong> coloque el <span className="font-mono">unique_identifier</span> (ej. <span className="font-mono">1-101</span>). Si no coincide directamente, también valida por <span className="font-mono">tower</span> y <span className="font-mono">unit_label</span>.
          </p>
          {fileName && (
            <p className="text-gray-700 pt-1">
              Archivo seleccionado: <strong>{fileName}</strong>
            </p>
          )}
        </div>
      </Card>

      {/* Prelación para Anticipos */}
      <Card>
        <div className="p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Prelación de Conceptos para Anticipos / Saldos a Favor</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Si alguna fila del cargue genera un saldo a favor superior a las deudas pendientes, se aplicará según este orden de prioridad (conceptos con <span className="font-mono">advance_account_id</span> configurado).
            </p>
          </div>

          {orderedAdvanceConcepts.length === 0 ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
              No hay conceptos activos con <span className="font-mono">advance_account_id</span> configurado. Si algún recibo del archivo genera anticipo, la validación alertará antes de guardar.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white">
              {orderedAdvanceConcepts.map((concept: any, idx: number) => (
                <div key={concept.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 font-mono text-xs font-bold flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <div>
                      <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded mr-2 text-gray-700">
                        {concept.code}
                      </span>
                      <span className="font-medium text-gray-900">{concept.name}</span>
                      {idx === 0 && (
                        <span className="ml-2 text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded">
                          Prioritario
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={idx === 0 || validating || saving}
                      onClick={() => moveAdvancePriority(idx, 'up')}
                      title="Subir prioridad"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={idx === orderedAdvanceConcepts.length - 1 || validating || saving}
                      onClick={() => moveAdvancePriority(idx, 'down')}
                      title="Bajar prioridad"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {validationErrors.length > 0 && (
        <Card>
          <div className="p-6 space-y-4">
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-red-900">
                  Se encontraron {validationErrors.length} error(es) de validación
                </h3>
                <p className="text-xs text-red-700 mt-0.5">
                  No se guardó ningún recibo. Corrija la plantilla y vuelva a cargarla para continuar.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto border border-red-200 rounded-lg">
              <table className="w-full text-left text-sm">
                <thead className="bg-red-50 text-red-900 uppercase text-xs border-b border-red-200">
                  <tr>
                    <th className="px-4 py-2.5">Fila</th>
                    <th className="px-4 py-2.5">Campo</th>
                    <th className="px-4 py-2.5">Detalle del error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100 bg-white">
                  {validationErrors.map((err, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-red-800">
                        {err.rowNumber > 0 ? `Fila ${err.rowNumber}` : 'General'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{err.field}</td>
                      <td className="px-4 py-2.5 text-red-700">{err.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {previewItems.length > 0 && validationErrors.length === 0 && (
        <Card>
          <div className="p-6 border-b border-gray-200 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                Previsualización de Recibos a Crear ({previewItems.length})
              </h3>
              <p className="text-sm text-gray-500">
                Revise la aplicación por prelación de pagos y confirme para generar los recibos y asientos contables.
              </p>
            </div>
            <Button type="button" onClick={handleConfirmBulkSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Contabilizando...
                </>
              ) : (
                `Confirmar y guardar ${previewItems.length} recibo(s)`
              )}
            </Button>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-gray-100 bg-gray-50/40">
            <div className="rounded-lg bg-white border border-gray-200 px-4 py-3">
              <p className="text-xs font-semibold text-gray-500 uppercase">Total a Recibir</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{formatCOP(totalPreviewAmount)}</p>
            </div>
            <div className="rounded-lg bg-white border border-gray-200 px-4 py-3">
              <p className="text-xs font-semibold text-gray-500 uppercase">Total Aplicado a Cartera</p>
              <p className="text-lg font-bold text-blue-700 mt-1">{formatCOP(totalPreviewApplied)}</p>
            </div>
            <div className="rounded-lg bg-white border border-gray-200 px-4 py-3">
              <p className="text-xs font-semibold text-gray-500 uppercase">Total Anticipos / Saldos a Favor</p>
              <p className="text-lg font-bold text-green-700 mt-1">{formatCOP(totalPreviewAdvance)}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Fila / Consecutivo</th>
                  <th className="px-4 py-3">Unidad</th>
                  <th className="px-4 py-3">Método</th>
                  <th className="px-4 py-3">Fechas (Pago / Cont.)</th>
                  <th className="px-4 py-3">Aplicación por Prelación</th>
                  <th className="px-4 py-3 text-right">Valor Recibido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {previewItems.map(item => (
                  <tr key={item.rowNumber} className="align-top hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      <div className="font-bold text-blue-700">{item.projectedReceiptNumber}</div>
                      <div className="text-gray-500">Fila {item.rowNumber}</div>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{item.unitLabel}</td>
                    <td className="px-4 py-3 text-gray-700">{item.paymentMethodName}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <div>Pago: {item.paymentDate}</div>
                      <div>Cont: {item.accountingDate}</div>
                    </td>
                    <td className="px-4 py-3 text-xs space-y-1">
                      {item.allocations.length > 0 ? (
                        item.allocations.map((a, idx) => (
                          <div key={idx} className="text-gray-700">
                            <span className="font-mono bg-gray-100 px-1 rounded mr-1">{a.period}</span>
                            <strong>{a.concept_code}</strong>: {formatCOP(a.capital_applied + a.interest_applied)}
                            {a.discount_applied > 0 && (
                              <span className="text-green-700 ml-1">(Desc: {formatCOP(a.discount_applied)})</span>
                            )}
                          </div>
                        ))
                      ) : (
                        <span className="text-gray-400">Sin aplicación a cuotas pendientes</span>
                      )}
                      {item.advanceAmount > 0 && (
                        <div className="text-green-700 font-medium">
                          Anticipo ({item.advanceConceptLabel}): {formatCOP(item.advanceAmount)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {formatCOP(item.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {saveError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <p className="text-sm text-red-700">{saveError}</p>
        </div>
      )}

      {createdSummary.length > 0 && (
        <Card>
          <div className="p-6 space-y-4">
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              <p className="text-sm font-medium text-green-800">
                Se crearon y contabilizaron {createdSummary.length} recibo(s) de caja correctamente.
              </p>
            </div>

            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-2.5">Fila</th>
                    <th className="px-4 py-2.5">Recibo Generado</th>
                    <th className="px-4 py-2.5">Unidad</th>
                    <th className="px-4 py-2.5 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {createdSummary.map(c => (
                    <tr key={c.receiptNumber}>
                      <td className="px-4 py-2.5 text-gray-500">Fila {c.rowNumber}</td>
                      <td className="px-4 py-2.5 font-mono font-bold text-blue-700">{c.receiptNumber}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{c.unitLabel}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{formatCOP(c.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}