import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Edit3,
  FileSpreadsheet,
  Loader2,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import { supabase, Due, Unit, BillingConcept } from '@/lib/supabase';
import { formatCOP } from '@/lib/format';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, TextArea } from '@/components/ui/Input';
import { NoOrgSelected } from '@/components/shared';
import { parseAmount, roundMoney } from '@/components/treasury/receiptAllocation';

type NoteType = 'NC' | 'ND' | 'NT';

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface ConceptRowForm {
  rowKey: string;
  section: 'principal' | 'abono' | 'cargo';
  conceptId: string;
  dueId: string;
  period: string;
  dueDate: string;
  pendingBalance: number;
  amount: string;
  discountAmount: string;
  advanceAmount: string;
  counterpartAccountId: string;
  offsetAccountId: string;
  lineNotes: string;
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

export function NotesTab() {
  const { activeOrg } = useOrg();
  const today = todayISO();

  const [loadingRef, setLoadingRef] = useState(true);
  const [refError, setRefError] = useState('');
  const [units, setUnits] = useState<Unit[]>([]);
  const [concepts, setConcepts] = useState<any[]>([]);
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

  // Saldos pendientes por unidad para facilitar abonos/traslados
  const [unitDuesMap, setUnitDuesMap] = useState<Record<string, Due[]>>({});
  const [unitInvoicesMap, setUnitInvoicesMap] = useState<Record<string, Record<string, any>>>({});

  // Filas para NC / ND
  const [standardRows, setStandardRows] = useState<ConceptRowForm[]>([]);
  // Filas para Traslado de Cartera (NT): Abono y Cargo
  const [abonoRows, setAbonoRows] = useState<ConceptRowForm[]>([]);
  const [cargoRows, setCargoRows] = useState<ConceptRowForm[]>([]);

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

    const [unitsRes, conceptsRes, accountsRes, periodRes, notesRes, linesRes] = await Promise.all([
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

    const loadedConcepts = conceptsRes.data || [];
    const loadedAccounts = (accountsRes.data || []) as AccountOption[];

    setUnits((unitsRes.data || []) as Unit[]);
    setConcepts(loadedConcepts);
    setAccounts(loadedAccounts);
    setActivePeriod(periodRes.data || null);
    setNotesList(notesRes.data || []);

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
      if (!activeOrg || !targetUnitId || unitDuesMap[targetUnitId]) return;

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
        invMap[inv.period] = inv;
        invMap[inv.id] = inv;
      });

      setUnitDuesMap(prev => ({ ...prev, [targetUnitId]: duesArr }));
      setUnitInvoicesMap(prev => ({ ...prev, [targetUnitId]: invMap }));
    },
    [activeOrg, unitDuesMap]
  );

  useEffect(() => {
    if (noteType === 'NT') {
      if (beneficiaryUnitId) ensureUnitPortfolioLoaded(beneficiaryUnitId);
      if (chargedUnitId) ensureUnitPortfolioLoaded(chargedUnitId);
    } else if (unitId) {
      ensureUnitPortfolioLoaded(unitId);
    }
  }, [noteType, unitId, beneficiaryUnitId, chargedUnitId, ensureUnitPortfolioLoaded]);

  function createEmptyRow(
    section: 'principal' | 'abono' | 'cargo',
    targetUnitId?: string
  ): ConceptRowForm {
    const firstConcept = concepts[0];
    const defaultPeriod =
      activePeriod?.start_date?.slice(0, 7) || applicationDate.slice(0, 7) || today.slice(0, 7);

    let pendingBalance = 0;
    let matchedDueId = '';
    let matchedPeriod = defaultPeriod;
    let matchedDueDate = applicationDate || today;

    if (targetUnitId && unitDuesMap[targetUnitId]?.length) {
      const firstDue = unitDuesMap[targetUnitId][0];
      matchedDueId = firstDue.id;
      matchedPeriod = firstDue.period || defaultPeriod;
      matchedDueDate = firstDue.due_date || applicationDate || today;
      pendingBalance = roundMoney(Number(firstDue.balance || 0));
    }

    const counterpart =
      firstConcept?.counterpart_account_id ||
      firstConcept?.income_account_id ||
      defaultOffsetAccountId;

    const offset =
      firstConcept?.income_account_id ||
      defaultOffsetAccountId;

    return {
      rowKey: makeRowKey(),
      section,
      conceptId: firstConcept?.id || '',
      dueId: matchedDueId,
      period: matchedPeriod,
      dueDate: matchedDueDate,
      pendingBalance,
      amount: '',
      discountAmount: '0',
      advanceAmount: '0',
      counterpartAccountId: counterpart,
      offsetAccountId: offset,
      lineNotes: '',
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
    field: keyof ConceptRowForm,
    value: any
  ) {
    const setter =
      section === 'principal'
        ? setStandardRows
        : section === 'abono'
        ? setAbonoRows
        : setCargoRows;

    setter(prev =>
      prev.map(r => {
        if (r.rowKey !== rowKey) return r;
        const updated = { ...r, [field]: value };

        if (field === 'conceptId') {
          const cObj = concepts.find(c => String(c.id) === String(value));
          if (cObj) {
            updated.counterpartAccountId =
              cObj.counterpart_account_id ||
              cObj.income_account_id ||
              updated.counterpartAccountId;
            if (!updated.offsetAccountId && cObj.income_account_id) {
              updated.offsetAccountId = cObj.income_account_id;
            }
          }
        }

        if (field === 'dueId') {
          const targetUnit =
            section === 'abono' ? beneficiaryUnitId : section === 'cargo' ? chargedUnitId : unitId;
          const dueList = unitDuesMap[targetUnit] || [];
          const foundDue = dueList.find(d => String(d.id) === String(value));
          if (foundDue) {
            updated.period = foundDue.period;
            updated.dueDate = foundDue.due_date;
            updated.pendingBalance = roundMoney(Number(foundDue.balance || 0));
          }
        }

        if (section === 'abono' && (field === 'amount' || field === 'discountAmount' || field === 'dueId')) {
          const amt = parseAmount(updated.amount || '0');
          const disc = parseAmount(updated.discountAmount || '0');
          const bal = Number(updated.pendingBalance || 0);
          if (bal > 0 && amt + disc > bal) {
            updated.advanceAmount = String(roundMoney(amt + disc - bal));
          } else {
            updated.advanceAmount = '0';
          }
        }

        return updated;
      })
    );
    setFormError('');
    setSuccessMsg('');
  }

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
      const ab: ConceptRowForm[] = lines
        .filter((l: any) => l.section === 'abono')
        .map((l: any) => ({
          rowKey: makeRowKey(),
          section: 'abono',
          conceptId: l.concept_id || '',
          dueId: l.due_id || '',
          period: l.period || '',
          dueDate: l.due_date || note.application_date,
          pendingBalance: 0,
          amount: String(l.amount ?? ''),
          discountAmount: String(l.discount_amount ?? '0'),
          advanceAmount: String(l.advance_amount ?? '0'),
          counterpartAccountId: l.counterpart_account_id || '',
          offsetAccountId: l.offset_account_id || '',
          lineNotes: l.line_notes || '',
        }));

      const cg: ConceptRowForm[] = lines
        .filter((l: any) => l.section === 'cargo')
        .map((l: any) => ({
          rowKey: makeRowKey(),
          section: 'cargo',
          conceptId: l.concept_id || '',
          dueId: l.due_id || '',
          period: l.period || '',
          dueDate: l.due_date || note.application_date,
          pendingBalance: 0,
          amount: String(l.amount ?? ''),
          discountAmount: String(l.discount_amount ?? '0'),
          advanceAmount: String(l.advance_amount ?? '0'),
          counterpartAccountId: l.counterpart_account_id || '',
          offsetAccountId: l.offset_account_id || '',
          lineNotes: l.line_notes || '',
        }));

      setAbonoRows(ab.length > 0 ? ab : [createEmptyRow('abono', note.beneficiary_unit_id)]);
      setCargoRows(cg.length > 0 ? cg : [createEmptyRow('cargo', note.charged_unit_id)]);
      setStandardRows([]);
    } else {
      const std: ConceptRowForm[] = lines.map((l: any) => ({
        rowKey: makeRowKey(),
        section: 'principal',
        conceptId: l.concept_id || '',
        dueId: l.due_id || '',
        period: l.period || '',
        dueDate: l.due_date || note.application_date,
        pendingBalance: 0,
        amount: String(l.amount ?? ''),
        discountAmount: String(l.discount_amount ?? '0'),
        advanceAmount: String(l.advance_amount ?? '0'),
        counterpartAccountId: l.counterpart_account_id || '',
        offsetAccountId: l.offset_account_id || '',
        lineNotes: l.line_notes || '',
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
    setUnitDuesMap({});
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
    setUnitDuesMap({});
    await loadReferenceAndNotes();
  }

  async function handleSaveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;

    if (!applicationDate || !accountingDate) {
      return setFormError('Debe indicar la fecha de aplicación y la fecha contable.');
    }

    if (!activePeriod) {
      return setFormError('No hay un período de trabajo activo configurado en el Calendario de Recaudo.');
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

      resolvedBeneficiaryId = beneficiaryUnitId;
      resolvedChargedId = chargedUnitId;
      resolvedUnitId = beneficiaryUnitId;

      const builtAbono = abonoRows
        .map(r => {
          const amt = roundMoney(parseAmount(r.amount || '0'));
          const disc = roundMoney(parseAmount(r.discountAmount || '0'));
          const adv = roundMoney(parseAmount(r.advanceAmount || '0'));
          return {
            section: 'abono',
            unit_id: beneficiaryUnitId,
            due_id: r.dueId || null,
            concept_id: r.conceptId,
            period: r.period || accountingDate.slice(0, 7),
            due_date: r.dueDate || applicationDate,
            amount: amt,
            discount_amount: disc,
            advance_amount: adv,
            counterpart_account_id: r.counterpartAccountId,
            offset_account_id: r.offsetAccountId,
            line_notes: r.lineNotes || description,
          };
        })
        .filter(l => l.amount + l.discount_amount + l.advance_amount > 0);

      const builtCargo = cargoRows
        .map(r => {
          const amt = roundMoney(parseAmount(r.amount || '0'));
          const disc = roundMoney(parseAmount(r.discountAmount || '0'));
          const adv = roundMoney(parseAmount(r.advanceAmount || '0'));
          return {
            section: 'cargo',
            unit_id: chargedUnitId,
            due_id: r.dueId || null,
            concept_id: r.conceptId,
            period: r.period || accountingDate.slice(0, 7),
            due_date: r.dueDate || applicationDate,
            amount: amt,
            discount_amount: disc,
            advance_amount: adv,
            counterpart_account_id: r.counterpartAccountId,
            offset_account_id: r.offsetAccountId,
            line_notes: r.lineNotes || description,
          };
        })
        .filter(l => l.amount + l.discount_amount + l.advance_amount > 0);

      if (builtAbono.length === 0 || builtCargo.length === 0) {
        return setFormError('En Traslado de Cartera (NT) debe ingresar valores en Abono y en Cargo.');
      }

      const sumAbono = roundMoney(
        builtAbono.reduce((acc, x) => acc + x.amount + x.discount_amount + x.advance_amount, 0)
      );
      const sumCargo = roundMoney(
        builtCargo.reduce((acc, x) => acc + x.amount + x.discount_amount + x.advance_amount, 0)
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
      resolvedUnitId = unitId;

      payloadLines = standardRows
        .map(r => {
          const amt = roundMoney(parseAmount(r.amount || '0'));
          const disc = roundMoney(parseAmount(r.discountAmount || '0'));
          const adv = roundMoney(parseAmount(r.advanceAmount || '0'));
          return {
            section: 'principal',
            unit_id: unitId,
            due_id: r.dueId || null,
            concept_id: r.conceptId,
            period: r.period || accountingDate.slice(0, 7),
            due_date: r.dueDate || applicationDate,
            amount: amt,
            discount_amount: disc,
            advance_amount: adv,
            counterpart_account_id: r.counterpartAccountId,
            offset_account_id: r.offsetAccountId,
            line_notes: r.lineNotes || description,
          };
        })
        .filter(l => l.amount + l.discount_amount + l.advance_amount > 0);

      if (payloadLines.length === 0) {
        return setFormError('Ingrese un valor mayor a cero en al menos un concepto.');
      }
    }

    const missingAccounts = payloadLines.some(
      l => !l.concept_id || !l.counterpart_account_id || !l.offset_account_id
    );
    if (missingAccounts) {
      return setFormError('Verifique que cada concepto tenga cuenta de cartera y cuenta de cruce.');
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
          throw new Error(error?.message || (data as any)?.message || 'No se pudo actualizar la nota.');
        }

        setSuccessMsg(`Nota ${(data as any)?.note_number || editingNoteNumber} actualizada correctamente.`);
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
          throw new Error(error?.message || (data as any)?.message || 'No se pudo registrar la nota.');
        }

        setSuccessMsg(`Nota ${(data as any).note_number} registrada y contabilizada correctamente.`);
      }

      setUnitDuesMap({});
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
    targetUnitId: string,
    showAbonoExtras = false
  ) {
    const unitDues = unitDuesMap[targetUnitId] || [];
    const conceptMap = new Map<string, BillingConcept>();
    concepts.forEach(c => conceptMap.set(String(c.id), c));

    return (
      <div className="space-y-3">
        {rows.map(row => {
          const cObj = conceptMap.get(String(row.conceptId));
          const counterpartAcc = accounts.find(a => a.id === row.counterpartAccountId);

          return (
            <div
              key={row.rowKey}
              className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 rounded-lg border border-gray-200 bg-gray-50/70 items-end"
            >
              <div className={showAbonoExtras ? 'md:col-span-3' : 'md:col-span-4'}>
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
                    {counterpartAcc ? `${counterpartAcc.code} · ${counterpartAcc.name}` : 'No configurada'}
                  </span>
                </p>
              </div>

              {unitDues.length > 0 && (
                <div className="md:col-span-2">
                  <Select
                    label="Cuota pendiente"
                    value={row.dueId}
                    onChange={e => updateRowField(section, row.rowKey, 'dueId', e.target.value)}
                  >
                    <option value="">— Ajuste / Sin cuota —</option>
                    {unitDues.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.period} ({formatCOP(Number(d.balance || 0))})
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div className={showAbonoExtras ? 'md:col-span-2' : 'md:col-span-2'}>
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

              {showAbonoExtras && (
                <>
                  <div className="md:col-span-1">
                    <Input
                      label="Desc."
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.discountAmount}
                      onChange={e =>
                        updateRowField(section, row.rowKey, 'discountAmount', e.target.value)
                      }
                    />
                  </div>
                  <div className="md:col-span-1">
                    <Input
                      label="Anticipo"
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.advanceAmount}
                      onChange={e =>
                        updateRowField(section, row.rowKey, 'advanceAmount', e.target.value)
                      }
                    />
                  </div>
                </>
              )}

              <div
                className={
                  showAbonoExtras
                    ? unitDues.length > 0
                      ? 'md:col-span-2'
                      : 'md:col-span-2'
                    : unitDues.length > 0
                    ? 'md:col-span-2'
                    : 'md:col-span-3'
                }
              >
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

              <div className="md:col-span-1 flex justify-end pb-0.5">
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

              {cObj && (
                <div className="md:col-span-12 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500 pt-2 border-t border-gray-200/70">
                  <span>
                    Período: <strong>{row.period || accountingDate.slice(0, 7)}</strong>
                    {row.pendingBalance > 0 && ` · Saldo cuota: ${formatCOP(row.pendingBalance)}`}
                  </span>
                  <input
                    type="text"
                    value={row.lineNotes}
                    onChange={e =>
                      updateRowField(section, row.rowKey, 'lineNotes', e.target.value)
                    }
                    placeholder="Detalle o nota del concepto (opcional)"
                    className="w-full sm:w-96 rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-800"
                  />
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

  const totalStandard = roundMoney(
    standardRows.reduce(
      (s, r) =>
        s +
        parseAmount(r.amount || '0') +
        parseAmount(r.discountAmount || '0') +
        parseAmount(r.advanceAmount || '0'),
      0
    )
  );
  const totalAbono = roundMoney(
    abonoRows.reduce(
      (s, r) =>
        s +
        parseAmount(r.amount || '0') +
        parseAmount(r.discountAmount || '0') +
        parseAmount(r.advanceAmount || '0'),
      0
    )
  );
  const totalCargo = roundMoney(
    cargoRows.reduce(
      (s, r) =>
        s +
        parseAmount(r.amount || '0') +
        parseAmount(r.discountAmount || '0') +
        parseAmount(r.advanceAmount || '0'),
      0
    )
  );

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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                      : 'Disminuye saldo en cartera del inmueble y debita la cuenta de cruce / acredita la cuenta del concepto.'}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-gray-500 uppercase font-semibold">Total Nota: </span>
                  <span className="text-base font-bold text-blue-700">{formatCOP(totalStandard)}</span>
                </div>
              </div>

              {renderConceptRows(standardRows, 'principal', unitId, false)}
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            <Card>
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-green-900">1. Abono (Inmueble beneficiado)</h3>
                    <p className="text-xs text-gray-500">
                      Se acredita/abona al inmueble beneficiado aplicando a conceptos pendientes.
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

                {renderConceptRows(abonoRows, 'abono', beneficiaryUnitId, true)}
              </div>
            </Card>

            <Card>
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-amber-900">2. Cargo (Inmueble debitado)</h3>
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

                {renderConceptRows(cargoRows, 'cargo', chargedUnitId, false)}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
    </div>
  );
}