import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Edit3,
  FileSpreadsheet,
  Loader2,
  Plus,
  Printer,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  supabase,
  Due,
  Unit,
  BillingConcept,
  PaymentHierarchyConfig,
} from '@/lib/supabase';
import { formatCOP } from '@/lib/format';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, TextArea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import {
  buildDetailedDueItems,
  DetailedDueItem,
  parseAmount,
  roundMoney,
} from '@/components/treasury/receiptAllocation';

type NoteType = 'NC' | 'ND' | 'NT';

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface ItemAllocationRow {
  itemId: string;
  dueId: string;
  conceptId: string;
  period: string;
  dueDate: string;
  conceptCode: string;
  conceptName: string;
  balance: number;
  appliedAmount: string;
}

interface ConceptRowForm {
  rowKey: string;
  section: 'principal' | 'abono' | 'cargo';
  conceptId: string;
  amount: string;
  counterpartAccountId: string;
  offsetAccountId: string;
  itemAllocations: ItemAllocationRow[];
}

interface UnitPortfolioData {
  dues: Due[];
  invoicesMap: Record<string, any>;
  detailedItems: DetailedDueItem[];
}

function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function unitDisplay(unit: any): string {
  if (!unit) return '—';
  return unit.tower ? `Torre ${unit.tower} · ${unit.unit_label}` : unit.unit_label;
}

function makeRowKey(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sortOldestFirst(items: DetailedDueItem[]): DetailedDueItem[] {
  return [...items].sort((a, b) => {
    const dA = String(a.dueDate || '');
    const dB = String(b.dueDate || '');
    if (dA !== dB) return dA.localeCompare(dB);
    const pA = String(a.period || '');
    const pB = String(b.period || '');
    if (pA !== pB) return pA.localeCompare(pB);
    return (a.priorityOrder ?? 999) - (b.priorityOrder ?? 999);
  });
}

function buildAllocationsFromDetailedItems(
  detailedItems: DetailedDueItem[],
  conceptId: string,
  totalAmountStr: string
): ItemAllocationRow[] {
  if (!conceptId) return [];

  const matching = sortOldestFirst(
    detailedItems.filter(
      it => Number(it.balance || 0) > 0 && String(it.conceptId) === String(conceptId)
    )
  );

  let remaining = roundMoney(Math.max(parseAmount(totalAmountStr || '0'), 0));

  return matching.map(it => {
    const bal = roundMoney(Number(it.balance || 0));
    const apply = roundMoney(Math.min(remaining, bal));
    remaining = roundMoney(Math.max(remaining - apply, 0));

    return {
      itemId: it.id,
      dueId: it.dueId,
      conceptId: it.conceptId,
      period: it.period || '',
      dueDate: it.dueDate || '',
      conceptCode: it.conceptCode,
      conceptName: it.conceptName,
      balance: bal,
      appliedAmount: apply > 0 ? String(apply) : '',
    };
  });
}

export function NotesTab() {
  const { activeOrg } = useOrg();
  const today = todayISO();

  const [loadingRef, setLoadingRef] = useState(true);
  const [refError, setRefError] = useState('');
  const [units, setUnits] = useState<Unit[]>([]);
  const [concepts, setConcepts] = useState<BillingConcept[]>([]);
  const [hierarchy, setHierarchy] = useState<PaymentHierarchyConfig[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [activePeriod, setActivePeriod] = useState<{
    start_date: string;
    end_date: string;
    name: string;
  } | null>(null);

  const [notesList, setNotesList] = useState<any[]>([]);
  const [noteLinesMap, setNoteLinesMap] = useState<Record<string, any[]>>({});
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Filtros de la tabla
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterUnitId, setFilterUnitId] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');

  // Estado del formulario de creación / edición
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteNumber, setEditingNoteNumber] = useState<string | null>(null);
  const [noteType, setNoteType] = useState<NoteType>('ND');
  const [applicationDate, setApplicationDate] = useState<string>(today);
  const [accountingDate, setAccountingDate] = useState<string>(today);
  const [unitId, setUnitId] = useState<string>('');
  const [beneficiaryUnitId, setBeneficiaryUnitId] = useState<string>('');
  const [chargedUnitId, setChargedUnitId] = useState<string>('');
  const [description, setDescription] = useState<string>('');

  // Cuenta contable para anticipo
  const [advanceAccountId, setAdvanceAccountId] = useState<string>('');

  // Cartera detallada por unidad
  const [unitPortfolioMap, setUnitPortfolioMap] = useState<Record<string, UnitPortfolioData>>({});

  // Filas para NC / ND
  const [standardRows, setStandardRows] = useState<ConceptRowForm[]>([]);
  // Filas para Traslado de Cartera (NT): Abono y Cargo
  const [abonoRows, setAbonoRows] = useState<ConceptRowForm[]>([]);
  const [cargoRows, setCargoRows] = useState<ConceptRowForm[]>([]);

  // Modal de impresión de nota
  const [printTarget, setPrintTarget] = useState<any | null>(null);

  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const defaultOffsetAccountId = useMemo(() => {
    return accounts[0]?.id || '';
  }, [accounts]);

  const loadReferenceAndNotes = useCallback(async () => {
    if (!activeOrg) return;
    setLoadingRef(true);
    setLoadingNotes(true);
    setRefError('');

    const [
      unitsRes,
      conceptsRes,
      hierarchyRes,
      accountsRes,
      periodRes,
      notesRes,
      linesRes,
    ] = await Promise.all([
      supabase
        .from('units')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('tower', { ascending: true })
        .order('unit_label', { ascending: true }),
      supabase
        .from('billing_concepts')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('payment_hierarchy_configs')
        .select('*, billing_concept:billing_concepts!concept_id(*)')
        .eq('organization_id', activeOrg.id)
        .order('priority_order', { ascending: true }),
      supabase
        .from('accounts')
        .select('id, code, name')
        .eq('organization_id', activeOrg.id)
        .order('code', { ascending: true }),
      supabase
        .from('revenue_periods')
        .select('start_date, end_date, name')
        .eq('organization_id', activeOrg.id)
        .eq('is_work_period_active', true)
        .maybeSingle(),
      supabase
        .from('treasury_notes')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('treasury_note_lines')
        .select('*')
        .eq('organization_id', activeOrg.id),
    ]);

    if (unitsRes.error || conceptsRes.error || accountsRes.error) {
      setRefError('No se pudieron cargar los datos de referencia para el módulo de Notas.');
      setLoadingRef(false);
      setLoadingNotes(false);
      return;
    }

    const loadedConcepts = (conceptsRes.data || []) as BillingConcept[];
    const loadedHierarchy = (hierarchyRes.data || []) as PaymentHierarchyConfig[];
    const loadedAccounts = (accountsRes.data || []) as AccountOption[];

    setUnits((unitsRes.data || []) as Unit[]);
    setConcepts(loadedConcepts);
    setHierarchy(loadedHierarchy);
    setAccounts(loadedAccounts);
    setActivePeriod(periodRes.data || null);
    setNotesList(notesRes.data || []);

    if (loadedAccounts.length > 0) {
      setAdvanceAccountId(prev => prev || loadedAccounts[0].id);
    }

    const byNote: Record<string, any[]> = {};
    (linesRes.data || []).forEach((ln: any) => {
      if (!byNote[ln.note_id]) byNote[ln.note_id] = [];
      byNote[ln.note_id].push(ln);
    });
    setNoteLinesMap(byNote);

    setLoadingRef(false);
    setLoadingNotes(false);
  }, [activeOrg]);

  useEffect(() => {
    loadReferenceAndNotes();
  }, [loadReferenceAndNotes]);

  const ensureUnitPortfolioLoaded = useCallback(
    async (targetUnitId: string) => {
      if (!activeOrg || !targetUnitId || unitPortfolioMap[targetUnitId]) return;

      const [duesRes, invRes] = await Promise.all([
        supabase
          .from('dues')
          .select('*')
          .eq('organization_id', activeOrg.id)
          .eq('unit_id', targetUnitId)
          .gt('balance', 0)
          .order('due_date', { ascending: true }),
        supabase
          .from('invoices')
          .select('*')
          .eq('organization_id', activeOrg.id)
          .eq('unit_id', targetUnitId),
      ]);

      const duesArr = (duesRes.data || []) as Due[];
      const invMap: Record<string, any> = {};
      (invRes.data || []).forEach((inv: any) => {
        invMap[`${inv.unit_id}_${inv.period}`] = inv;
        invMap[inv.period] = inv;
        invMap[inv.id] = inv;
      });

      const detailedItems = buildDetailedDueItems(
        duesArr,
        hierarchy,
        concepts,
        invMap,
        [],
        applicationDate || today,
        0
      );

      setUnitPortfolioMap(prev => ({
        ...prev,
        [targetUnitId]: {
          dues: duesArr,
          invoicesMap: invMap,
          detailedItems,
        },
      }));
    },
    [activeOrg, unitPortfolioMap, hierarchy, concepts, applicationDate, today]
  );

  useEffect(() => {
    if (noteType === 'NT') {
      if (beneficiaryUnitId) ensureUnitPortfolioLoaded(beneficiaryUnitId);
      if (chargedUnitId) ensureUnitPortfolioLoaded(chargedUnitId);
    } else if (unitId) {
      ensureUnitPortfolioLoaded(unitId);
    }
  }, [noteType, unitId, beneficiaryUnitId, chargedUnitId, ensureUnitPortfolioLoaded]);

  useEffect(() => {
    if (noteType === 'NC' && unitId && unitPortfolioMap[unitId]) {
      const items = unitPortfolioMap[unitId].detailedItems;
      setStandardRows(prev =>
        prev.map(r => ({
          ...r,
          itemAllocations: buildAllocationsFromDetailedItems(items, r.conceptId, r.amount),
        }))
      );
    }
  }, [noteType, unitId, unitPortfolioMap]);

  useEffect(() => {
    if (noteType === 'NT' && beneficiaryUnitId && unitPortfolioMap[beneficiaryUnitId]) {
      const items = unitPortfolioMap[beneficiaryUnitId].detailedItems;
      setAbonoRows(prev =>
        prev.map(r => ({
          ...r,
          itemAllocations: buildAllocationsFromDetailedItems(items, r.conceptId, r.amount),
        }))
      );
    }
  }, [noteType, beneficiaryUnitId, unitPortfolioMap]);

  function createEmptyRow(
    section: 'principal' | 'abono' | 'cargo',
    targetUnitId?: string
  ): ConceptRowForm {
    const firstConcept = concepts[0];
    const counterpart =
      (firstConcept as any)?.counterpart_account_id ||
      (firstConcept as any)?.income_account_id ||
      defaultOffsetAccountId;
    const offset = (firstConcept as any)?.income_account_id || defaultOffsetAccountId;

    const items = targetUnitId ? unitPortfolioMap[targetUnitId]?.detailedItems || [] : [];
    const itemAllocations =
      section === 'principal' || section === 'abono'
        ? buildAllocationsFromDetailedItems(items, firstConcept?.id || '', '')
        : [];

    return {
      rowKey: makeRowKey(),
      section,
      conceptId: firstConcept?.id || '',
      amount: '',
      counterpartAccountId: counterpart,
      offsetAccountId: offset,
      itemAllocations,
    };
  }

  function resetForm(nextType?: NoteType) {
    const t = nextType || noteType;
    setEditingNoteId(null);
    setEditingNoteNumber(null);
    setNoteType(t);
    setApplicationDate(activePeriod?.start_date || today);
    setAccountingDate(activePeriod?.start_date || today);
    setUnitId('');
    setBeneficiaryUnitId('');
    setChargedUnitId('');
    setDescription('');
    setStandardRows([]);
    setAbonoRows([]);
    setCargoRows([]);
    setFormError('');
  }

  function handleChangeNoteType(nextType: NoteType) {
    resetForm(nextType);
    if (nextType === 'NC' || nextType === 'ND') {
      setStandardRows([createEmptyRow('principal')]);
    } else {
      setAbonoRows([createEmptyRow('abono')]);
      setCargoRows([createEmptyRow('cargo')]);
    }
  }

  function addRow(section: 'principal' | 'abono' | 'cargo') {
    const targetUnit =
      section === 'abono' ? beneficiaryUnitId : section === 'cargo' ? chargedUnitId : unitId;
    const newRow = createEmptyRow(section, targetUnit);

    if (section === 'principal') {
      setStandardRows(prev => [...prev, newRow]);
    } else if (section === 'abono') {
      setAbonoRows(prev => [...prev, newRow]);
    } else {
      setCargoRows(prev => [...prev, newRow]);
    }
  }

  function removeRow(section: 'principal' | 'abono' | 'cargo', rowKey: string) {
    if (section === 'principal') {
      setStandardRows(prev => prev.filter(r => r.rowKey !== rowKey));
    } else if (section === 'abono') {
      setAbonoRows(prev => prev.filter(r => r.rowKey !== rowKey));
    } else {
      setCargoRows(prev => prev.filter(r => r.rowKey !== rowKey));
    }
  }

  function updateRowField(
    section: 'principal' | 'abono' | 'cargo',
    rowKey: string,
    field: 'conceptId' | 'amount' | 'counterpartAccountId' | 'offsetAccountId',
    value: string
  ) {
    const setter =
      section === 'principal'
        ? setStandardRows
        : section === 'abono'
        ? setAbonoRows
        : setCargoRows;

    const targetUnit =
      section === 'abono' ? beneficiaryUnitId : section === 'cargo' ? chargedUnitId : unitId;
    const items = targetUnit ? unitPortfolioMap[targetUnit]?.detailedItems || [] : [];

    setter(prev =>
      prev.map(r => {
        if (r.rowKey !== rowKey) return r;
        const updated = { ...r, [field]: value };

        if (field === 'conceptId') {
          const cObj: any = concepts.find(c => String(c.id) === String(value));
          if (cObj) {
            updated.counterpartAccountId =
              cObj.counterpart_account_id ||
              cObj.income_account_id ||
              updated.counterpartAccountId;
            if (!updated.offsetAccountId && cObj.income_account_id) {
              updated.offsetAccountId = cObj.income_account_id;
            }
          }
          if (section === 'principal' || section === 'abono') {
            updated.itemAllocations = buildAllocationsFromDetailedItems(
              items,
              updated.conceptId,
              updated.amount
            );
          }
        }

        if (field === 'amount') {
          if (section === 'principal' || section === 'abono') {
            updated.itemAllocations = buildAllocationsFromDetailedItems(
              items,
              updated.conceptId,
              value
            );
          }
        }

        return updated;
      })
    );
    setFormError('');
    setSuccessMsg('');
  }

  function updateItemAllocationAmount(
    section: 'principal' | 'abono',
    rowKey: string,
    itemId: string,
    newAppliedStr: string
  ) {
    const setter = section === 'principal' ? setStandardRows : setAbonoRows;

    setter(prev =>
      prev.map(r => {
        if (r.rowKey !== rowKey) return r;
        const nextAllocs = r.itemAllocations.map(a => {
          if (a.itemId !== itemId) return a;
          const numeric = Math.max(0, parseAmount(newAppliedStr || '0'));
          const capped = Math.min(numeric, a.balance);
          return {
            ...a,
            appliedAmount: newAppliedStr === '' ? '' : String(roundMoney(capped)),
          };
        });
        const sumApplied = roundMoney(
          nextAllocs.reduce((s, a) => s + parseAmount(a.appliedAmount || '0'), 0)
        );
        return {
          ...r,
          itemAllocations: nextAllocs,
          amount: sumApplied > 0 ? String(sumApplied) : r.amount,
        };
      })
    );
    setFormError('');
    setSuccessMsg('');
  }

  const ncPendingTotal = useMemo(() => {
    if (noteType !== 'NC' || !unitId) return 0;
    const items = unitPortfolioMap[unitId]?.detailedItems || [];
    return roundMoney(items.reduce((acc, it) => acc + Number(it.balance || 0), 0));
  }, [noteType, unitId, unitPortfolioMap]);

  const ncInputTotal = useMemo(() => {
    if (noteType !== 'NC') return 0;
    return roundMoney(standardRows.reduce((s, r) => s + parseAmount(r.amount || '0'), 0));
  }, [noteType, standardRows]);

  const ncAdvanceAmount = useMemo(() => {
    if (noteType !== 'NC' || !unitId || ncInputTotal <= 0) return 0;
    if (ncPendingTotal === 0) return ncInputTotal;
    if (ncInputTotal > ncPendingTotal) return roundMoney(ncInputTotal - ncPendingTotal);
    return 0;
  }, [noteType, unitId, ncPendingTotal, ncInputTotal]);

  const beneficiaryTotalPendingBalance = useMemo(() => {
    if (!beneficiaryUnitId) return 0;
    const items = unitPortfolioMap[beneficiaryUnitId]?.detailedItems || [];
    return roundMoney(items.reduce((acc, it) => acc + Number(it.balance || 0), 0));
  }, [beneficiaryUnitId, unitPortfolioMap]);

  const rawAbonoInputTotal = useMemo(() => {
    return roundMoney(abonoRows.reduce((s, r) => s + parseAmount(r.amount || '0'), 0));
  }, [abonoRows]);

  const calculatedAdvanceAmount = useMemo(() => {
    if (noteType !== 'NT' || !beneficiaryUnitId || rawAbonoInputTotal <= 0) return 0;
    if (beneficiaryTotalPendingBalance === 0) return rawAbonoInputTotal;
    if (rawAbonoInputTotal > beneficiaryTotalPendingBalance) {
      return roundMoney(rawAbonoInputTotal - beneficiaryTotalPendingBalance);
    }
    return 0;
  }, [noteType, beneficiaryUnitId, beneficiaryTotalPendingBalance, rawAbonoInputTotal]);

  const showAdvanceBox =
    (noteType === 'NC' && ncAdvanceAmount > 0) ||
    (noteType === 'NT' && calculatedAdvanceAmount > 0);

  function handleEditNote(note: any) {
    const lines = noteLinesMap[note.id] || [];
    setEditingNoteId(note.id);
    setEditingNoteNumber(note.note_number);
    setNoteType((note.note_type as NoteType) || 'ND');
    setApplicationDate(note.application_date || today);
    setAccountingDate(note.accounting_date || today);
    setUnitId(note.unit_id || '');
    setBeneficiaryUnitId(note.beneficiary_unit_id || '');
    setChargedUnitId(note.charged_unit_id || '');
    setDescription(note.description || '');
    setFormError('');
    setSuccessMsg('');

    if (note.note_type === 'NT') {
      const abLines = lines.filter((l: any) => l.section === 'abono');
      const advLine = abLines.find((l: any) => Number(l.advance_amount || 0) > 0);
      if (advLine?.counterpart_account_id) {
        setAdvanceAccountId(advLine.counterpart_account_id);
      }

      const ab: ConceptRowForm[] = abLines.map((l: any) => ({
        rowKey: makeRowKey(),
        section: 'abono',
        conceptId: l.concept_id || '',
        amount: String(Number(l.amount || 0) + Number(l.advance_amount || 0)),
        counterpartAccountId: l.counterpart_account_id || '',
        offsetAccountId: l.offset_account_id || '',
        itemAllocations: l.due_id
          ? [
              {
                itemId: `${l.due_id}-${l.concept_id}`,
                dueId: l.due_id,
                conceptId: l.concept_id,
                period: l.period || '',
                dueDate: l.due_date || note.application_date,
                conceptCode: '',
                conceptName: '',
                balance: Number(l.amount || 0),
                appliedAmount: String(l.amount || 0),
              },
            ]
          : [],
      }));

      const cg: ConceptRowForm[] = lines
        .filter((l: any) => l.section === 'cargo')
        .map((l: any) => ({
          rowKey: makeRowKey(),
          section: 'cargo',
          conceptId: l.concept_id || '',
          amount: String(l.amount ?? ''),
          counterpartAccountId: l.counterpart_account_id || '',
          offsetAccountId: l.offset_account_id || '',
          itemAllocations: [],
        }));

      setAbonoRows(ab.length > 0 ? ab : [createEmptyRow('abono', note.beneficiary_unit_id)]);
      setCargoRows(cg.length > 0 ? cg : [createEmptyRow('cargo', note.charged_unit_id)]);
      setStandardRows([]);
    } else {
      const std: ConceptRowForm[] = lines.map((l: any) => ({
        rowKey: makeRowKey(),
        section: 'principal',
        conceptId: l.concept_id || '',
        amount: String(Number(l.amount || 0) + Number(l.advance_amount || 0)),
        counterpartAccountId: l.counterpart_account_id || '',
        offsetAccountId: l.offset_account_id || '',
        itemAllocations: l.due_id
          ? [
              {
                itemId: `${l.due_id}-${l.concept_id}`,
                dueId: l.due_id,
                conceptId: l.concept_id,
                period: l.period || '',
                dueDate: l.due_date || note.application_date,
                conceptCode: '',
                conceptName: '',
                balance: Number(l.amount || 0),
                appliedAmount: String(l.amount || 0),
              },
            ]
          : [],
      }));
      setStandardRows(std.length > 0 ? std : [createEmptyRow('principal', note.unit_id)]);
      setAbonoRows([]);
      setCargoRows([]);
    }
  }

  async function handleVoidNote(note: any) {
    if (!activeOrg) return;
    if (
      !window.confirm(
        `¿Está seguro de ANULAR la nota ${note.note_number}? Se reversará su efecto en cartera y se eliminará su asiento contable.`
      )
    ) {
      return;
    }
    setActionId(note.id);
    setFormError('');
    setSuccessMsg('');

    const { data, error } = await supabase.rpc('void_treasury_note', {
      p_note_id: note.id,
      p_organization_id: activeOrg.id,
    });

    setActionId(null);
    if (error || (data && (data as any).success === false)) {
      setFormError(error?.message || (data as any)?.message || 'No se pudo anular la nota.');
      return;
    }

    setSuccessMsg(`Nota ${note.note_number} anulada y reversada en cartera y contabilidad.`);
    setUnitPortfolioMap({});
    await loadReferenceAndNotes();
  }

  async function handleDeleteNote(note: any) {
    if (!activeOrg) return;
    if (
      !window.confirm(
        `¿Está seguro de ELIMINAR definitivamente la nota ${note.note_number}? Se reversará la cartera y se borrará el asiento contable.`
      )
    ) {
      return;
    }
    setActionId(note.id);
    setFormError('');
    setSuccessMsg('');

    const { data, error } = await supabase.rpc('delete_treasury_note', {
      p_note_id: note.id,
      p_organization_id: activeOrg.id,
    });

    setActionId(null);
    if (error || (data && (data as any).success === false)) {
      setFormError(error?.message || (data as any)?.message || 'No se pudo eliminar la nota.');
      return;
    }

    setSuccessMsg(`Nota ${note.note_number} eliminada correctamente.`);
    setUnitPortfolioMap({});
    await loadReferenceAndNotes();
  }

  function buildPayloadLinesForRows(
    rows: ConceptRowForm[],
    section: 'principal' | 'abono' | 'cargo',
    targetUnitId: string,
    advanceTotal: number
  ): any[] {
    let remainingAdvance = roundMoney(advanceTotal);
    const result: any[] = [];

    for (const r of rows) {
      const totalRowAmt = roundMoney(parseAmount(r.amount || '0'));
      if (totalRowAmt <= 0) continue;

      const activeAllocs = (r.itemAllocations || []).filter(
        a => roundMoney(parseAmount(a.appliedAmount || '0')) > 0
      );

      if ((section === 'principal' || section === 'abono') && activeAllocs.length > 0) {
        for (const alloc of activeAllocs) {
          const applied = roundMoney(parseAmount(alloc.appliedAmount || '0'));
          if (applied <= 0) continue;
          result.push({
            section,
            unit_id: targetUnitId,
            due_id: alloc.dueId,
            concept_id: r.conceptId,
            period: alloc.period || accountingDate.slice(0, 7),
            due_date: alloc.dueDate || applicationDate,
            amount: applied,
            discount_amount: 0,
            advance_amount: 0,
            counterpart_account_id: r.counterpartAccountId,
            offset_account_id: r.offsetAccountId,
            line_notes: description,
          });
        }

        const sumAllocs = roundMoney(
          activeAllocs.reduce((s, a) => s + parseAmount(a.appliedAmount || '0'), 0)
        );
        const leftoverOnRow = roundMoney(Math.max(totalRowAmt - sumAllocs, 0));
        if (leftoverOnRow > 0 && remainingAdvance > 0) {
          const advPortion = roundMoney(Math.min(leftoverOnRow, remainingAdvance));
          remainingAdvance = roundMoney(Math.max(remainingAdvance - advPortion, 0));
          if (advPortion > 0) {
            result.push({
              section,
              unit_id: targetUnitId,
              due_id: null,
              concept_id: r.conceptId,
              period: accountingDate.slice(0, 7),
              due_date: applicationDate,
              amount: 0,
              discount_amount: 0,
              advance_amount: advPortion,
              counterpart_account_id: advanceAccountId || r.counterpartAccountId,
              offset_account_id: r.offsetAccountId || defaultOffsetAccountId,
              line_notes: description,
            });
          }
        }
      } else {
        let advPortion = 0;
        if ((section === 'principal' || section === 'abono') && remainingAdvance > 0) {
          advPortion = roundMoney(Math.min(totalRowAmt, remainingAdvance));
          remainingAdvance = roundMoney(Math.max(remainingAdvance - advPortion, 0));
        }
        const appliedAmt = roundMoney(Math.max(totalRowAmt - advPortion, 0));

        result.push({
          section,
          unit_id: targetUnitId,
          due_id: null,
          concept_id: r.conceptId,
          period: accountingDate.slice(0, 7),
          due_date: applicationDate,
          amount: appliedAmt,
          discount_amount: 0,
          advance_amount: advPortion,
          counterpart_account_id:
            advPortion > 0 && appliedAmt === 0
              ? advanceAccountId || r.counterpartAccountId
              : r.counterpartAccountId,
          offset_account_id: r.offsetAccountId || defaultOffsetAccountId,
          line_notes: description,
        });
      }
    }

    return result;
  }

  async function handleSaveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;

    if (!applicationDate || !accountingDate) {
      return setFormError('Debe indicar la fecha de aplicación y la fecha contable.');
    }

    if (!activePeriod) {
      return setFormError(
        'No hay un período de trabajo activo configurado en el Calendario de Recaudo.'
      );
    }

    if (applicationDate < activePeriod.start_date || applicationDate > activePeriod.end_date) {
      return setFormError(
        `La fecha de aplicación (${applicationDate}) está fuera del período activo (${activePeriod.name}: ${activePeriod.start_date} a ${activePeriod.end_date}).`
      );
    }

    if (accountingDate < activePeriod.start_date || accountingDate > activePeriod.end_date) {
      return setFormError(
        `La fecha contable (${accountingDate}) está fuera del período activo (${activePeriod.name}: ${activePeriod.start_date} a ${activePeriod.end_date}).`
      );
    }

    let payloadLines: any[] = [];
    let resolvedUnitId: string | null = null;
    let resolvedBeneficiaryId: string | null = null;
    let resolvedChargedId: string | null = null;

    if (noteType === 'NT') {
      if (!beneficiaryUnitId) {
        return setFormError('Seleccione el inmueble beneficiado en la sección Abono.');
      }
      if (!chargedUnitId) {
        return setFormError('Seleccione el inmueble a debitar en la sección Cargo.');
      }
      if (calculatedAdvanceAmount > 0 && !advanceAccountId) {
        return setFormError(
          'Seleccione la cuenta contable para el anticipo generado en el abono.'
        );
      }

      resolvedBeneficiaryId = beneficiaryUnitId;
      resolvedChargedId = chargedUnitId;
      resolvedUnitId = beneficiaryUnitId;

      const builtAbono = buildPayloadLinesForRows(
        abonoRows,
        'abono',
        beneficiaryUnitId,
        calculatedAdvanceAmount
      );
      const builtCargo = buildPayloadLinesForRows(cargoRows, 'cargo', chargedUnitId, 0);

      if (builtAbono.length === 0 || builtCargo.length === 0) {
        return setFormError(
          'En Traslado de Cartera (NT) debe ingresar valores en Abono y en Cargo.'
        );
      }

      const sumAbono = roundMoney(
        builtAbono.reduce((acc, x) => acc + Number(x.amount || 0) + Number(x.advance_amount || 0), 0)
      );
      const sumCargo = roundMoney(
        builtCargo.reduce((acc, x) => acc + Number(x.amount || 0), 0)
      );

      if (sumAbono !== sumCargo) {
        return setFormError(
          `El total de Abono (${formatCOP(sumAbono)}) debe coincidir con el total de Cargo (${formatCOP(sumCargo)}) para mantener la partida doble.`
        );
      }

      payloadLines = [...builtAbono, ...builtCargo];
    } else {
      if (!unitId) {
        return setFormError('Seleccione el inmueble al cual aplica la nota.');
      }
      if (noteType === 'NC' && ncAdvanceAmount > 0 && !advanceAccountId) {
        return setFormError(
          'Seleccione la cuenta contable para el anticipo generado en la Nota Crédito.'
        );
      }

      resolvedUnitId = unitId;
      payloadLines = buildPayloadLinesForRows(
        standardRows,
        'principal',
        unitId,
        noteType === 'NC' ? ncAdvanceAmount : 0
      );

      if (payloadLines.length === 0) {
        return setFormError('Ingrese un valor mayor a cero en al menos un concepto.');
      }
    }

    const missingAccounts = payloadLines.some(
      l => !l.concept_id || !l.counterpart_account_id || !l.offset_account_id
    );
    if (missingAccounts) {
      return setFormError('Verifique que cada concepto tenga cuenta asignada.');
    }

    setSaving(true);
    setFormError('');
    setSuccessMsg('');

    try {
      if (editingNoteId) {
        const { data, error } = await supabase.rpc('update_treasury_note', {
          p_note_id: editingNoteId,
          p_organization_id: activeOrg.id,
          p_application_date: applicationDate,
          p_accounting_date: accountingDate,
          p_unit_id: resolvedUnitId,
          p_beneficiary_unit_id: resolvedBeneficiaryId,
          p_charged_unit_id: resolvedChargedId,
          p_description: description,
          p_lines: payloadLines,
        });

        if (error || (data && (data as any).success === false)) {
          throw new Error(
            error?.message || (data as any)?.message || 'No se pudo actualizar la nota.'
          );
        }

        setSuccessMsg(
          `Nota ${(data as any)?.note_number || editingNoteNumber} actualizada correctamente.`
        );
      } else {
        const { data, error } = await supabase.rpc('save_treasury_note', {
          p_organization_id: activeOrg.id,
          p_note_type: noteType,
          p_application_date: applicationDate,
          p_accounting_date: accountingDate,
          p_unit_id: resolvedUnitId,
          p_beneficiary_unit_id: resolvedBeneficiaryId,
          p_charged_unit_id: resolvedChargedId,
          p_description: description,
          p_lines: payloadLines,
        });

        if (error || !(data as any)?.note_number) {
          throw new Error(
            error?.message || (data as any)?.message || 'No se pudo registrar la nota.'
          );
        }

        setSuccessMsg(
          `Nota ${(data as any).note_number} registrada y contabilizada correctamente.`
        );
      }

      setUnitPortfolioMap({});
      resetForm(noteType);
      handleChangeNoteType(noteType);
      await loadReferenceAndNotes();
    } catch (err: any) {
      setFormError(err?.message || 'Ocurrió un error al guardar la nota.');
    } finally {
      setSaving(false);
    }
  }

  const filteredNotes = useMemo(() => {
    return notesList.filter(n => {
      if (filterType !== 'ALL' && n.note_type !== filterType) return false;
      if (filterUnitId) {
        const matchesUnit =
          n.unit_id === filterUnitId ||
          n.beneficiary_unit_id === filterUnitId ||
          n.charged_unit_id === filterUnitId;
        if (!matchesUnit) return false;
      }
      if (filterDateFrom && String(n.accounting_date || '') < filterDateFrom) return false;
      if (filterDateTo && String(n.accounting_date || '') > filterDateTo) return false;
      return true;
    });
  }, [notesList, filterType, filterUnitId, filterDateFrom, filterDateTo]);

  function renderConceptRows(
    rows: ConceptRowForm[],
    section: 'principal' | 'abono' | 'cargo',
    showDueBreakdown: boolean,
    showOffsetAccount: boolean
  ) {
    return (
      <div className="space-y-3">
        {rows.map(row => {
          const counterpartAcc = accounts.find(a => a.id === row.counterpartAccountId);
          const hasAllocations = showDueBreakdown && row.itemAllocations.length > 0;
          const totalAppliedInTable = roundMoney(
            row.itemAllocations.reduce((s, a) => s + parseAmount(a.appliedAmount || '0'), 0)
          );
          const totalBalanceInTable = roundMoney(
            row.itemAllocations.reduce((s, a) => s + Number(a.balance || 0), 0)
          );

          return (
            <div
              key={row.rowKey}
              className="p-4 rounded-lg border border-gray-200 bg-gray-50/70 space-y-3"
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                <div className={showOffsetAccount ? 'md:col-span-5' : 'md:col-span-7'}>
                  <Select
                    label="Concepto *"
                    value={row.conceptId}
                    onChange={e => updateRowField(section, row.rowKey, 'conceptId', e.target.value)}
                  >
                    <option value="">— Concepto —</option>
                    {concepts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </Select>
                  <p className="text-[11px] text-gray-500 mt-1 truncate">
                    Cuenta concepto (defecto):{' '}
                    <span className="font-mono text-gray-700">
                      {counterpartAcc
                        ? `${counterpartAcc.code} · ${counterpartAcc.name}`
                        : 'No configurada'}
                    </span>
                  </p>
                </div>

                <div className="md:col-span-2">
                  <Input
                    label="Valor a aplicar *"
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.amount}
                    onChange={e => updateRowField(section, row.rowKey, 'amount', e.target.value)}
                    placeholder="0"
                  />
                </div>

                {showOffsetAccount && (
                  <div className="md:col-span-4">
                    <Select
                      label="Cuenta contable cruce *"
                      value={row.offsetAccountId}
                      onChange={e =>
                        updateRowField(section, row.rowKey, 'offsetAccountId', e.target.value)
                      }
                    >
                      <option value="">— Seleccionar cuenta —</option>
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.code} — {acc.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}

                <div className="md:col-span-1 flex justify-end pt-6">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-red-700 border-red-200 hover:bg-red-50"
                    onClick={() => removeRow(section, row.rowKey)}
                    title="Quitar concepto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {hasAllocations && (
                <div className="border-t border-gray-200 pt-3">
                  <p className="text-[11px] font-semibold uppercase text-gray-600 mb-2">
                    Aplicación discriminada por documento (más antiguo a más reciente)
                  </p>
                  <div className="overflow-x-auto rounded border border-gray-200 bg-white">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
                        <tr>
                          <th className="px-3 py-1.5">Período</th>
                          <th className="px-3 py-1.5">Vencimiento</th>
                          <th className="px-3 py-1.5 text-right">Saldo pendiente</th>
                          <th className="px-3 py-1.5 text-right w-40">Valor a aplicar</th>
                          <th className="px-3 py-1.5 text-right">Nuevo saldo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {row.itemAllocations.map(alloc => {
                          const appliedNum = roundMoney(parseAmount(alloc.appliedAmount || '0'));
                          const newBal = roundMoney(Math.max(alloc.balance - appliedNum, 0));
                          return (
                            <tr key={alloc.itemId}>
                              <td className="px-3 py-1.5 font-mono text-gray-800">
                                {alloc.period || '—'}
                              </td>
                              <td className="px-3 py-1.5 text-gray-600">
                                {alloc.dueDate || '—'}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono text-gray-800">
                                {formatCOP(alloc.balance)}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                <input
                                  type="number"
                                  min={0}
                                  max={alloc.balance}
                                  step="0.01"
                                  value={alloc.appliedAmount}
                                  onChange={e =>
                                    updateItemAllocationAmount(
                                      section === 'abono' ? 'abono' : 'principal',
                                      row.rowKey,
                                      alloc.itemId,
                                      e.target.value
                                    )
                                  }
                                  placeholder="0"
                                  className="w-32 rounded border border-gray-300 bg-white px-2 py-1 text-right font-mono text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono text-gray-700">
                                {formatCOP(newBal)}
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-gray-50/70 font-semibold text-gray-800">
                          <td colSpan={2} className="px-3 py-1.5 text-right">
                            Totales del concepto:
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-gray-900">
                            {formatCOP(totalBalanceInTable)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-blue-700">
                            {formatCOP(totalAppliedInTable)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-gray-800">
                            {formatCOP(
                              roundMoney(Math.max(totalBalanceInTable - totalAppliedInTable, 0))
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => addRow(section)}
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> Agregar concepto
        </Button>
      </div>
    );
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

  const unitById = new Map<string, any>();
  units.forEach(u => unitById.set(String(u.id), u));

  const conceptById = new Map<string, BillingConcept>();
  concepts.forEach(c => conceptById.set(String(c.id), c));

  const accountById = new Map<string, AccountOption>();
  accounts.forEach(a => accountById.set(String(a.id), a));

  const totalStandard = roundMoney(
    standardRows.reduce((s, r) => s + parseAmount(r.amount || '0'), 0)
  );
  const totalAbono = rawAbonoInputTotal;
  const totalCargo = roundMoney(
    cargoRows.reduce((s, r) => s + parseAmount(r.amount || '0'), 0)
  );
  const activeAdvanceAmount = noteType === 'NC' ? ncAdvanceAmount : calculatedAdvanceAmount;

  return (
    <div className="space-y-6">
      <form onSubmit={handleSaveNote} className="space-y-6">
        {editingNoteId && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
            <p className="text-sm font-medium text-blue-900">
              Editando la nota <strong>{editingNoteNumber}</strong>. Se reversará el movimiento anterior y se contabilizará el ajuste.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleChangeNoteType(noteType)}
            >
              <XCircle className="w-4 h-4 mr-1 text-gray-600" /> Cancelar edición
            </Button>
          </div>
        )}

        <Card>
          <div className="p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Registro de Notas Crédito, Notas Débito y Traslados de Cartera
                </h2>
                {activePeriod ? (
                  <p className="text-xs text-blue-700 font-medium mt-1">
                    Período de trabajo activo: {activePeriod.name} ({activePeriod.start_date} a{' '}
                    {activePeriod.end_date})
                  </p>
                ) : (
                  <p className="text-xs text-red-700 font-medium mt-1">
                    Sin período de trabajo activo configurado en el Calendario de Recaudo.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(['ND', 'NC', 'NT'] as NoteType[]).map(t => {
                  const active = noteType === t;
                  const label =
                    t === 'ND'
                      ? 'Nota Débito (ND)'
                      : t === 'NC'
                      ? 'Nota Crédito (NC)'
                      : 'Traslado de Cartera (NT)';
                  return (
                    <button
                      key={t}
                      type="button"
                      disabled={Boolean(editingNoteId)}
                      onClick={() => handleChangeNoteType(t)}
                      className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                        active
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      } disabled:opacity-60`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
              <Input
                label="Fecha de aplicación *"
                type="date"
                value={applicationDate}
                onChange={e => setApplicationDate(e.target.value)}
                required
              />
              <Input
                label="Fecha contable *"
                type="date"
                value={accountingDate}
                onChange={e => setAccountingDate(e.target.value)}
                required
              />

              {noteType !== 'NT' && (
                <Select
                  label="Inmueble *"
                  value={unitId}
                  onChange={e => setUnitId(e.target.value)}
                  required
                >
                  <option value="">— Seleccionar inmueble —</option>
                  {units.map(u => (
                    <option key={u.id} value={u.id}>
                      {unitDisplay(u)}
                    </option>
                  ))}
                </Select>
              )}

              <div className={noteType === 'NT' ? 'lg:col-span-2' : 'lg:col-span-1'}>
                <TextArea
                  label="Observaciones / Descripción *"
                  rows={1}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Motivo contable y de cartera de la nota..."
                />
              </div>
            </div>
          </div>
        </Card>

        {noteType !== 'NT' ? (
          <Card>
            <div className="p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Conceptos a aplicar en {noteType === 'ND' ? 'Nota Débito (ND)' : 'Nota Crédito (NC)'}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {noteType === 'ND'
                      ? 'Aumenta saldo en cartera del inmueble y debita la cuenta del concepto / acredita la cuenta de cruce.'
                      : 'Disminuye saldo en cartera del inmueble aplicando del documento más antiguo al más reciente; si no hay saldo pendiente aplica como anticipo.'}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-gray-500 uppercase font-semibold">Total Nota: </span>
                  <span className="text-base font-bold text-blue-700">{formatCOP(totalStandard)}</span>
                </div>
              </div>

              {renderConceptRows(standardRows, 'principal', noteType === 'NC', true)}

              {showAdvanceBox && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase text-emerald-900">
                      Anticipo a aplicar (sin saldo pendiente o excedente sobre saldo pendiente)
                    </span>
                    <span className="text-sm font-bold text-emerald-800">
                      {formatCOP(activeAdvanceAmount)}
                    </span>
                  </div>
                  <div className="max-w-md">
                    <Select
                      label="Cuenta contable de anticipo *"
                      value={advanceAccountId}
                      onChange={e => setAdvanceAccountId(e.target.value)}
                    >
                      <option value="">— Seleccionar cuenta anticipo —</option>
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.code} — {acc.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              )}
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            <Card>
              <div className="p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-green-900">
                      1. Abono (Inmueble beneficiado)
                    </h3>
                    <p className="text-xs text-gray-500">
                      Aplica del documento más antiguo al más reciente; si no hay saldo pendiente, se registra como anticipo.
                      {beneficiaryUnitId && (
                        <span className="ml-1 font-medium text-gray-700">
                          Saldo pendiente total: {formatCOP(beneficiaryTotalPendingBalance)}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="text-base font-bold text-green-700">{formatCOP(totalAbono)}</span>
                </div>

                <div className="max-w-md">
                  <Select
                    label="Inmueble beneficiado (Abono) *"
                    value={beneficiaryUnitId}
                    onChange={e => setBeneficiaryUnitId(e.target.value)}
                    required
                  >
                    <option value="">— Seleccionar inmueble beneficiado —</option>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>
                        {unitDisplay(u)}
                      </option>
                    ))}
                  </Select>
                </div>

                {renderConceptRows(abonoRows, 'abono', true, false)}

                {showAdvanceBox && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase text-emerald-900">
                        Anticipo a aplicar (sin saldo pendiente o excedente sobre saldo pendiente)
                      </span>
                      <span className="text-sm font-bold text-emerald-800">
                        {formatCOP(activeAdvanceAmount)}
                      </span>
                    </div>
                    <div className="max-w-md">
                      <Select
                        label="Cuenta contable de anticipo *"
                        value={advanceAccountId}
                        onChange={e => setAdvanceAccountId(e.target.value)}
                      >
                        <option value="">— Seleccionar cuenta anticipo —</option>
                        {accounts.map(acc => (
                          <option key={acc.id} value={acc.id}>
                            {acc.code} — {acc.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-amber-900">
                      2. Cargo (Inmueble debitado)
                    </h3>
                    <p className="text-xs text-gray-500">
                      Se carga/debita al inmueble afectado usando por defecto la cuenta del concepto.
                    </p>
                  </div>
                  <span className="text-base font-bold text-amber-800">{formatCOP(totalCargo)}</span>
                </div>

                <div className="max-w-md">
                  <Select
                    label="Inmueble a debitar (Cargo) *"
                    value={chargedUnitId}
                    onChange={e => setChargedUnitId(e.target.value)}
                    required
                  >
                    <option value="">— Seleccionar inmueble debitado —</option>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>
                        {unitDisplay(u)}
                      </option>
                    ))}
                  </Select>
                </div>

                {renderConceptRows(cargoRows, 'cargo', false, false)}
              </div>
            </Card>
          </div>
        )}

        {formError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <p className="text-sm text-red-700">{formError}</p>
          </div>
        )}

        {successMsg && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            <p className="text-sm text-green-800 font-medium">{successMsg}</p>
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Guardando...
              </>
            ) : editingNoteId ? (
              `Actualizar ${editingNoteNumber}`
            ) : (
              `Registrar ${noteType}`
            )}
          </Button>
        </div>
      </form>

      {/* Tabla filtrable de Notas */}
      <Card>
        <div className="p-6 border-b border-gray-200 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                Historial de Notas y Traslados de Cartera
              </h3>
              <p className="text-sm text-gray-500">
                Filtre por tipo de nota, inmueble o fecha contable.
              </p>
            </div>
            <span className="text-xs font-mono text-gray-500">
              {filteredNotes.length} registro(s)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <Select
              label="Tipo de nota"
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
            >
              <option value="ALL">Todos los tipos</option>
              <option value="ND">Nota Débito (ND)</option>
              <option value="NC">Nota Crédito (NC)</option>
              <option value="NT">Traslado de Cartera (NT)</option>
            </Select>

            <Select
              label="Inmueble"
              value={filterUnitId}
              onChange={e => setFilterUnitId(e.target.value)}
            >
              <option value="">Todos los inmuebles</option>
              {units.map(u => (
                <option key={u.id} value={u.id}>
                  {unitDisplay(u)}
                </option>
              ))}
            </Select>

            <Input
              label="Desde (fecha contable)"
              type="date"
              value={filterDateFrom}
              onChange={e => setFilterDateFrom(e.target.value)}
            />

            <Input
              label="Hasta (fecha contable)"
              type="date"
              value={filterDateTo}
              onChange={e => setFilterDateTo(e.target.value)}
            />
          </div>
        </div>

        {loadingNotes ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <FileSpreadsheet className="w-10 h-10 mx-auto text-gray-300 mb-2" />
            <p>No hay notas registradas con los filtros seleccionados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Documento</th>
                  <th className="px-4 py-3">Fechas (Apl. / Cont.)</th>
                  <th className="px-4 py-3">Inmueble(s)</th>
                  <th className="px-4 py-3">Descripción</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredNotes.map(n => {
                  const isVoided = n.status === 'anulado';
                  const busy = actionId === n.id;
                  const unitDesc =
                    n.note_type === 'NT'
                      ? `Abono: ${unitDisplay(unitById.get(String(n.beneficiary_unit_id)))} · Cargo: ${unitDisplay(unitById.get(String(n.charged_unit_id)))}`
                      : unitDisplay(unitById.get(String(n.unit_id)));

                  return (
                    <tr key={n.id} className={`hover:bg-gray-50 ${isVoided ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-3 font-mono font-bold text-blue-700">
                        {n.note_number}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        <div>Apl: {n.application_date}</div>
                        <div>Cont: {n.accounting_date}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-gray-900">{unitDesc}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">
                        {n.description || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {isVoided ? (
                          <span className="px-2 py-0.5 text-xs font-semibold rounded bg-red-100 text-red-800">
                            ANULADO
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-xs font-semibold rounded bg-green-100 text-green-800">
                            CONTABILIZADO
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {formatCOP(isVoided ? 0 : Number(n.total_amount || 0))}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPrintTarget(n)}
                            title="Imprimir nota"
                          >
                            <Printer className="w-3.5 h-3.5 mr-1" /> Imprimir
                          </Button>
                          {!isVoided && (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => handleEditNote(n)}
                              >
                                <Edit3 className="w-3.5 h-3.5 mr-1" /> Editar
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-amber-700 border-amber-300 hover:bg-amber-50"
                                disabled={busy}
                                onClick={() => handleVoidNote(n)}
                              >
                                <Ban className="w-3.5 h-3.5 mr-1" /> Anular
                              </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-red-700 border-red-300 hover:bg-red-50"
                            disabled={busy}
                            onClick={() => handleDeleteNote(n)}
                          >
                            {busy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </Button>
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

      {/* Modal Imprimir Nota */}
      <Modal
        open={!!printTarget}
        onClose={() => setPrintTarget(null)}
        title={printTarget ? `Documento de Tesorería · ${printTarget.note_number}` : 'Imprimir Nota'}
        size="lg"
      >
        {printTarget && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gray-50 p-3.5 rounded-lg border border-gray-200 text-xs">
              <div>
                <span className="text-gray-500 block">Documento</span>
                <strong className="text-sm font-mono text-blue-700">
                  {printTarget.note_number}
                </strong>
              </div>
              <div>
                <span className="text-gray-500 block">Fecha Aplicación / Contable</span>
                <strong className="text-sm text-gray-900">
                  {printTarget.application_date} / {printTarget.accounting_date}
                </strong>
              </div>
              <div>
                <span className="text-gray-500 block">Total</span>
                <strong className="text-sm text-gray-900">
                  {formatCOP(
                    printTarget.status === 'anulado' ? 0 : Number(printTarget.total_amount || 0)
                  )}
                </strong>
              </div>
              <div className="sm:col-span-3">
                <span className="text-gray-500 block">Descripción</span>
                <span className="text-sm text-gray-800">
                  {printTarget.description || 'Sin descripción'}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2">Sección / Inmueble</th>
                    <th className="text-left px-3 py-2">Concepto</th>
                    <th className="text-left px-3 py-2">Cuenta Cruce</th>
                    <th className="text-right px-3 py-2">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(noteLinesMap[printTarget.id] || []).map((ln: any) => {
                    const cObj = conceptById.get(String(ln.concept_id));
                    const uObj = unitById.get(String(ln.unit_id));
                    const accObj = accountById.get(String(ln.offset_account_id));
                    const lineVal =
                      Number(ln.amount || 0) +
                      Number(ln.discount_amount || 0) +
                      Number(ln.advance_amount || 0);
                    return (
                      <tr key={ln.id}>
                        <td className="px-3 py-2 text-xs text-gray-800">
                          {ln.section && ln.section !== 'principal'
                            ? `${String(ln.section).toUpperCase()} · `
                            : ''}
                          {unitDisplay(uObj)}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-800">
                          {cObj ? `${cObj.code} — ${cObj.name}` : 'Concepto'}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-gray-600">
                          {accObj ? `${accObj.code} — ${accObj.name}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-gray-900">
                          {formatCOP(lineVal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="outline" onClick={() => setPrintTarget(null)}>
                Cerrar
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="w-4 h-4" /> Imprimir
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}