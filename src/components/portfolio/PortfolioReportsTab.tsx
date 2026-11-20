import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Printer,
  Table as TableIcon,
} from 'lucide-react';
import {
  supabase,
  Unit,
  BillingConcept,
  PaymentHierarchyConfig,
} from '@/lib/supabase';
import { formatCOP } from '@/lib/format';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { NoOrgSelected } from '@/components/shared';
import {
  buildDetailedDueItems,
  DetailedDueItem,
  roundMoney,
} from '@/components/treasury/receiptAllocation';

type ReportKey =
  | 'statement_summary'
  | 'statement_detailed'
  | 'by_concept'
  | 'by_aging';

interface PaymentMethodOption {
  id: string;
  name: string;
}

interface ThirdPartyOption {
  id: string;
  name: string;
  document_number?: string | null;
}

function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function unitLabelText(u: any): string {
  if (!u) return '—';
  return u.tower ? `Torre ${u.tower} · ${u.unit_label}` : String(u.unit_label || '—');
}

function daysPastDue(dueDateStr: string | null | undefined, cutoffDateStr: string): number {
  if (!dueDateStr) return 0;
  const due = new Date(`${dueDateStr.slice(0, 10)}T00:00:00`);
  const cut = new Date(`${cutoffDateStr.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime()) || Number.isNaN(cut.getTime())) return 0;
  return Math.floor((cut.getTime() - due.getTime()) / 86400000);
}

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const sep = ';';
  const lines = [
    headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(sep),
    ...rows.map(r =>
      r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(sep)
    ),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function PortfolioReportsTab() {
  const { activeOrg } = useOrg();
  const today = todayISO();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [activeReport, setActiveReport] = useState<ReportKey>('statement_summary');
  const [cutoffDate, setCutoffDate] = useState<string>(today);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>(today);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [selectedTower, setSelectedTower] = useState<string>('ALL');
  const [selectedConceptId, setSelectedConceptId] = useState<string>('ALL');

  const [units, setUnits] = useState<Unit[]>([]);
  const [concepts, setConcepts] = useState<BillingConcept[]>([]);
  const [hierarchy, setHierarchy] = useState<PaymentHierarchyConfig[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [thirdParties, setThirdParties] = useState<ThirdPartyOption[]>([]);
  const [dues, setDues] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [noteLines, setNoteLines] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    setErrorMsg('');

    const [
      unitsRes,
      conceptsRes,
      hierarchyRes,
      pmRes,
      tpRes,
      duesRes,
      invRes,
      recRes,
      notesRes,
      noteLinesRes,
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
        .from('payment_methods')
        .select('id, name')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true),
      supabase
        .from('third_parties')
        .select('id, name, document_number')
        .eq('organization_id', activeOrg.id),
      supabase
        .from('dues')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .order('due_date', { ascending: true }),
      supabase
        .from('invoices')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .order('issue_date', { ascending: true }),
      supabase
        .from('receipts')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .order('payment_date', { ascending: true }),
      supabase
        .from('treasury_notes')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .order('accounting_date', { ascending: true }),
      supabase
        .from('treasury_note_lines')
        .select('*')
        .eq('organization_id', activeOrg.id),
    ]);

    if (unitsRes.error || conceptsRes.error || duesRes.error) {
      setErrorMsg('No se pudieron cargar los datos de cartera para los reportes.');
      setLoading(false);
      return;
    }

    setUnits((unitsRes.data || []) as Unit[]);
    setConcepts((conceptsRes.data || []) as BillingConcept[]);
    setHierarchy((hierarchyRes.data || []) as PaymentHierarchyConfig[]);
    setPaymentMethods((pmRes.data || []) as PaymentMethodOption[]);
    setThirdParties((tpRes.data || []) as ThirdPartyOption[]);
    setDues(duesRes.data || []);
    setInvoices(invRes.data || []);
    setReceipts(recRes.data || []);
    setNotes(notesRes.data || []);
    setNoteLines(noteLinesRes.data || []);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const towers = useMemo(() => {
    const set = new Set<string>();
    units.forEach(u => {
      if (u.tower) set.add(String(u.tower));
    });
    return Array.from(set).sort();
  }, [units]);

  const filteredUnits = useMemo(() => {
    return units.filter(u => {
      if (selectedTower !== 'ALL' && String(u.tower || '') !== selectedTower) return false;
      if (selectedUnitId && String(u.id) !== selectedUnitId) return false;
      return true;
    });
  }, [units, selectedTower, selectedUnitId]);

  const allowedUnitIds = useMemo(() => {
    return new Set(filteredUnits.map(u => String(u.id)));
  }, [filteredUnits]);

  const unitMap = useMemo(() => {
    const m = new Map<string, any>();
    units.forEach(u => m.set(String(u.id), u));
    return m;
  }, [units]);

  const conceptMap = useMemo(() => {
    const m = new Map<string, BillingConcept>();
    concepts.forEach(c => m.set(String(c.id), c));
    return m;
  }, [concepts]);

  const pmMap = useMemo(() => {
    const m = new Map<string, string>();
    paymentMethods.forEach(p => m.set(String(p.id), p.name));
    return m;
  }, [paymentMethods]);

  const tpMap = useMemo(() => {
    const m = new Map<string, ThirdPartyOption>();
    thirdParties.forEach(t => m.set(String(t.id), t));
    return m;
  }, [thirdParties]);

  // Ítems detallados de cartera por unidad (reutilizando buildDetailedDueItems)
  const allDetailedItems = useMemo(() => {
    const items: (DetailedDueItem & { unitId: string })[] = [];
    const duesByUnit = new Map<string, any[]>();
    const invByUnit = new Map<string, Record<string, any>>();

    dues.forEach(d => {
      const uid = String(d.unit_id || '');
      if (!allowedUnitIds.has(uid)) return;
      if (d.status === 'anulado' || d.status === 'void') return;
      if (!duesByUnit.has(uid)) duesByUnit.set(uid, []);
      duesByUnit.get(uid)!.push(d);
    });

    invoices.forEach(inv => {
      const uid = String(inv.unit_id || '');
      if (!allowedUnitIds.has(uid)) return;
      if (!invByUnit.has(uid)) invByUnit.set(uid, {});
      const map = invByUnit.get(uid)!;
      map[`${inv.unit_id}_${inv.period}`] = inv;
      map[inv.period] = inv;
      map[inv.id] = inv;
    });

    allowedUnitIds.forEach(uid => {
      const uDues = duesByUnit.get(uid) || [];
      const uInv = invByUnit.get(uid) || {};
      const det = buildDetailedDueItems(
        uDues,
        hierarchy,
        concepts,
        uInv,
        [],
        cutoffDate || today,
        0
      );
      det.forEach(item => {
        if (
          selectedConceptId !== 'ALL' &&
          String(item.conceptId) !== selectedConceptId
        ) {
          return;
        }
        items.push({ ...item, unitId: uid });
      });
    });

    return items;
  }, [
    dues,
    invoices,
    allowedUnitIds,
    hierarchy,
    concepts,
    cutoffDate,
    today,
    selectedConceptId,
  ]);

  // KPIs ejecutivos
  const kpis = useMemo(() => {
    let totalPortfolio = 0;
    let overduePortfolio = 0;
    let advanceTotal = 0;

    allDetailedItems.forEach(it => {
      const bal = roundMoney(Number(it.balance || 0));
      totalPortfolio = roundMoney(totalPortfolio + bal);
      if (bal > 0 && daysPastDue(it.dueDate, cutoffDate || today) > 0) {
        overduePortfolio = roundMoney(overduePortfolio + bal);
      }
    });

    receipts.forEach(r => {
      if (r.status === 'anulado' || r.status === 'void') return;
      if (!allowedUnitIds.has(String(r.unit_id || ''))) return;
      if (cutoffDate && String(r.accounting_date || r.payment_date || '') > cutoffDate) {
        return;
      }
      advanceTotal = roundMoney(advanceTotal + Number(r.advance_amount || 0));
    });

    noteLines.forEach(ln => {
      const parentNote = notes.find(n => String(n.id) === String(ln.note_id));
      if (!parentNote || parentNote.status === 'anulado') return;
      if (!allowedUnitIds.has(String(ln.unit_id || parentNote.unit_id || ''))) return;
      if (cutoffDate && String(parentNote.accounting_date || '') > cutoffDate) return;
      advanceTotal = roundMoney(advanceTotal + Number(ln.advance_amount || 0));
    });

    const collectedInRange = roundMoney(
      receipts.reduce((sum, r) => {
        if (r.status === 'anulado' || r.status === 'void') return sum;
        if (!allowedUnitIds.has(String(r.unit_id || ''))) return sum;
        const dt = String(r.payment_date || r.accounting_date || '');
        if (dateFrom && dt < dateFrom) return sum;
        if (dateTo && dt > dateTo) return sum;
        return sum + Number(r.total_amount || 0);
      }, 0)
    );

    return {
      totalPortfolio,
      overduePortfolio,
      collectedInRange,
      advanceTotal,
    };
  }, [
    allDetailedItems,
    receipts,
    notes,
    noteLines,
    allowedUnitIds,
    cutoffDate,
    today,
    dateFrom,
    dateTo,
  ]);

  // 1. Estado de Cuenta Resumido (por período y conceptos)
  const summaryStatementRows = useMemo(() => {
    const targetUnitId =
      selectedUnitId || (filteredUnits.length === 1 ? String(filteredUnits[0].id) : '');
    if (!targetUnitId) return [];

    const byPeriod = new Map<
      string,
      {
        period: string;
        admon: number;
        intereses: number;
        retroactivo: number;
        cuotaExtra: number;
        otros: number;
        totalCobro: number;
        ajustes: number;
        pagos: number;
        saldo: number;
        lastPaymentDate: string;
      }
    >();

    const getOrCreate = (periodKey: string) => {
      if (!byPeriod.has(periodKey)) {
        byPeriod.set(periodKey, {
          period: periodKey,
          admon: 0,
          intereses: 0,
          retroactivo: 0,
          cuotaExtra: 0,
          otros: 0,
          totalCobro: 0,
          ajustes: 0,
          pagos: 0,
          saldo: 0,
          lastPaymentDate: '',
        });
      }
      return byPeriod.get(periodKey)!;
    };

    invoices
      .filter(
        inv =>
          String(inv.unit_id) === targetUnitId &&
          inv.status !== 'anulado' &&
          (!cutoffDate || String(inv.issue_date || '') <= cutoffDate)
      )
      .forEach(inv => {
        const p = String(inv.period || 'SIN PERIODO');
        const row = getOrCreate(p);
        const snapItems = Array.isArray(inv.items_snapshot) ? inv.items_snapshot : [];

        if (snapItems.length > 0) {
          snapItems.forEach((it: any) => {
            const cObj = conceptMap.get(String(it.concept_id || ''));
            const label = `${cObj?.code || ''} ${cObj?.name || it.concept_name || it.name || ''}`.toUpperCase();
            const val = Number(it.amount ?? it.total ?? 0);
            if (label.includes('INTERES') || cObj?.is_late_interest) {
              row.intereses = roundMoney(row.intereses + val);
            } else if (label.includes('RETRO')) {
              row.retroactivo = roundMoney(row.retroactivo + val);
            } else if (label.includes('EXTRA')) {
              row.cuotaExtra = roundMoney(row.cuotaExtra + val);
            } else if (label.includes('ADMON') || label.includes('ADMIN')) {
              row.admon = roundMoney(row.admon + val);
            } else {
              row.otros = roundMoney(row.otros + val);
            }
          });
        } else {
          row.admon = roundMoney(row.admon + Number(inv.subtotal || 0));
          row.intereses = roundMoney(row.intereses + Number(inv.interest_amount || 0));
        }

        row.totalCobro = roundMoney(
          row.admon + row.intereses + row.retroactivo + row.cuotaExtra + row.otros
        );
      });

    dues
      .filter(
        d =>
          String(d.unit_id) === targetUnitId &&
          d.status !== 'anulado' &&
          (!cutoffDate || String(d.due_date || '') <= cutoffDate)
      )
      .forEach(d => {
        const p = String(d.period || 'SIN PERIODO');
        const row = getOrCreate(p);
        if (row.totalCobro === 0 && Number(d.amount || 0) > 0) {
          row.admon = roundMoney(row.admon + Number(d.amount || 0));
          row.totalCobro = roundMoney(row.totalCobro + Number(d.amount || 0));
        }
        row.saldo = roundMoney(row.saldo + Number(d.balance || 0));
      });

    receipts
      .filter(
        r =>
          String(r.unit_id) === targetUnitId &&
          r.status !== 'anulado' &&
          r.status !== 'void' &&
          (!cutoffDate || String(r.payment_date || r.accounting_date || '') <= cutoffDate)
      )
      .forEach(r => {
        const dt = String(r.payment_date || r.accounting_date || '');
        const pKey = dt ? dt.slice(0, 7) : 'GENERAL';
        const target = byPeriod.has(pKey)
          ? byPeriod.get(pKey)!
          : Array.from(byPeriod.values()).slice(-1)[0] || getOrCreate(pKey);
        const amt = Number(r.total_amount || 0);
        target.pagos = roundMoney(target.pagos - amt);
        if (dt && (!target.lastPaymentDate || dt > target.lastPaymentDate)) {
          target.lastPaymentDate = dt;
        }
      });

    noteLines.forEach(ln => {
      const parent = notes.find(n => String(n.id) === String(ln.note_id));
      if (!parent || parent.status === 'anulado') return;
      const lineUnit = String(ln.unit_id || parent.unit_id || '');
      if (lineUnit !== targetUnitId) return;
      if (cutoffDate && String(parent.accounting_date || '') > cutoffDate) return;

      const pKey = String(ln.period || parent.period || parent.accounting_date?.slice(0, 7) || 'GENERAL');
      const target = byPeriod.has(pKey)
        ? byPeriod.get(pKey)!
        : getOrCreate(pKey);
      const val =
        Number(ln.amount || 0) +
        Number(ln.discount_amount || 0) +
        Number(ln.advance_amount || 0);

      if (parent.note_type === 'ND' || ln.section === 'cargo') {
        target.ajustes = roundMoney(target.ajustes + val);
      } else {
        target.ajustes = roundMoney(target.ajustes - val);
      }
    });

    const sorted = Array.from(byPeriod.values()).sort((a, b) =>
      a.period.localeCompare(b.period)
    );

    let runningSaldo = 0;
    return sorted.map(r => {
      const netPeriod = roundMoney(r.totalCobro + r.ajustes + r.pagos);
      runningSaldo = roundMoney(runningSaldo + netPeriod);
      return {
        ...r,
        saldo: runningSaldo,
      };
    });
  }, [
    selectedUnitId,
    filteredUnits,
    invoices,
    dues,
    receipts,
    notes,
    noteLines,
    conceptMap,
    cutoffDate,
  ]);

  // 2. Estado de Cuenta Detallado (auxiliar cronológico de movimientos)
  const detailedStatementRows = useMemo(() => {
    const targetUnitId =
      selectedUnitId || (filteredUnits.length === 1 ? String(filteredUnits[0].id) : '');
    if (!targetUnitId) return [];

    const uObj = unitMap.get(targetUnitId);
    const tpObj = uObj?.third_party_id ? tpMap.get(String(uObj.third_party_id)) : null;

    const events: {
      date: string;
      doc: string;
      detail: string;
      admon: number;
      intereses: number;
      retroactivo: number;
      cuotaExtra: number;
      otros: number;
      delta: number;
    }[] = [];

    invoices
      .filter(
        inv =>
          String(inv.unit_id) === targetUnitId &&
          inv.status !== 'anulado' &&
          (!cutoffDate || String(inv.issue_date || '') <= cutoffDate)
      )
      .forEach(inv => {
        const sub = Number(inv.subtotal || 0);
        const intr = Number(inv.interest_amount || 0);
        const tot = Number(inv.total_amount || sub + intr);
        events.push({
          date: String(inv.issue_date || inv.due_date || ''),
          doc: String(inv.invoice_number || `CC-${inv.period || ''}`),
          detail: `Cuenta de cobro período ${inv.period || ''}`,
          admon: sub,
          intereses: intr,
          retroactivo: 0,
          cuotaExtra: 0,
          otros: 0,
          delta: tot,
        });
      });

    receipts
      .filter(
        r =>
          String(r.unit_id) === targetUnitId &&
          r.status !== 'anulado' &&
          r.status !== 'void' &&
          (!cutoffDate || String(r.payment_date || r.accounting_date || '') <= cutoffDate)
      )
      .forEach(r => {
        const amt = Number(r.total_amount || 0);
        const pmName = r.payment_method_id ? pmMap.get(String(r.payment_method_id)) : '';
        events.push({
          date: String(r.payment_date || r.accounting_date || ''),
          doc: String(r.receipt_number || 'RC'),
          detail: `Recibo de caja${pmName ? ` (${pmName})` : ''}${r.notes ? ` · ${r.notes}` : ''}`,
          admon: -amt,
          intereses: 0,
          retroactivo: 0,
          cuotaExtra: 0,
          otros: 0,
          delta: -amt,
        });
      });

    noteLines.forEach(ln => {
      const parent = notes.find(n => String(n.id) === String(ln.note_id));
      if (!parent || parent.status === 'anulado') return;
      const lineUnit = String(ln.unit_id || parent.unit_id || '');
      if (lineUnit !== targetUnitId) return;
      if (cutoffDate && String(parent.accounting_date || '') > cutoffDate) return;

      const cObj = conceptMap.get(String(ln.concept_id || ''));
      const val =
        Number(ln.amount || 0) +
        Number(ln.discount_amount || 0) +
        Number(ln.advance_amount || 0);
      const isDebit = parent.note_type === 'ND' || ln.section === 'cargo';
      const signed = isDebit ? val : -val;

      events.push({
        date: String(parent.accounting_date || parent.application_date || ''),
        doc: String(parent.note_number || parent.note_type),
        detail: `${parent.note_type} · ${cObj?.name || 'Concepto'}${parent.description ? ` · ${parent.description}` : ''}`,
        admon: signed,
        intereses: 0,
        retroactivo: 0,
        cuotaExtra: 0,
        otros: 0,
        delta: signed,
      });
    });

    events.sort((a, b) => a.date.localeCompare(b.date));

    let running = 0;
    return events.map(ev => {
      running = roundMoney(running + ev.delta);
      return {
        ...ev,
        code: unitLabelText(uObj),
        ownerName: tpObj?.name || uObj?.owner_name || '—',
        docId: tpObj?.document_number || uObj?.owner_document || '—',
        balance: running,
      };
    });
  }, [
    selectedUnitId,
    filteredUnits,
    unitMap,
    tpMap,
    pmMap,
    conceptMap,
    invoices,
    receipts,
    notes,
    noteLines,
    cutoffDate,
  ]);

  // 3. Cartera por Conceptos
  const byConceptRows = useMemo(() => {
    const map = new Map<
      string,
      {
        conceptId: string;
        code: string;
        name: string;
        currentAmt: number;
        overdueAmt: number;
        totalAmt: number;
        unitSet: Set<string>;
      }
    >();

    allDetailedItems.forEach(it => {
      const bal = roundMoney(Number(it.balance || 0));
      if (bal <= 0) return;
      const cid = String(it.conceptId);
      const cObj = conceptMap.get(cid);
      if (!map.has(cid)) {
        map.set(cid, {
          conceptId: cid,
          code: cObj?.code || it.conceptCode || '—',
          name: cObj?.name || it.conceptName || 'Concepto',
          currentAmt: 0,
          overdueAmt: 0,
          totalAmt: 0,
          unitSet: new Set<string>(),
        });
      }
      const row = map.get(cid)!;
      const past = daysPastDue(it.dueDate, cutoffDate || today);
      if (past > 0) {
        row.overdueAmt = roundMoney(row.overdueAmt + bal);
      } else {
        row.currentAmt = roundMoney(row.currentAmt + bal);
      }
      row.totalAmt = roundMoney(row.totalAmt + bal);
      row.unitSet.add(String(it.unitId));
    });

    return Array.from(map.values())
      .map(r => ({
        ...r,
        unitsCount: r.unitSet.size,
      }))
      .sort((a, b) => b.totalAmt - a.totalAmt);
  }, [allDetailedItems, conceptMap, cutoffDate, today]);

  // 4. Cartera por Edades
  const byAgingRows = useMemo(() => {
    const map = new Map<
      string,
      {
        unitId: string;
        unitLabel: string;
        ownerName: string;
        currentAmt: number;
        d1_30: number;
        d31_60: number;
        d61_90: number;
        d90_plus: number;
        totalAmt: number;
      }
    >();

    allDetailedItems.forEach(it => {
      const bal = roundMoney(Number(it.balance || 0));
      if (bal <= 0) return;
      const uid = String(it.unitId);
      const uObj = unitMap.get(uid);
      if (!map.has(uid)) {
        map.set(uid, {
          unitId: uid,
          unitLabel: unitLabelText(uObj),
          ownerName: uObj?.owner_name || '—',
          currentAmt: 0,
          d1_30: 0,
          d31_60: 0,
          d61_90: 0,
          d90_plus: 0,
          totalAmt: 0,
        });
      }
      const row = map.get(uid)!;
      const past = daysPastDue(it.dueDate, cutoffDate || today);

      if (past <= 0) {
        row.currentAmt = roundMoney(row.currentAmt + bal);
      } else if (past <= 30) {
        row.d1_30 = roundMoney(row.d1_30 + bal);
      } else if (past <= 60) {
        row.d31_60 = roundMoney(row.d31_60 + bal);
      } else if (past <= 90) {
        row.d61_90 = roundMoney(row.d61_90 + bal);
      } else {
        row.d90_plus = roundMoney(row.d90_plus + bal);
      }
      row.totalAmt = roundMoney(row.totalAmt + bal);
    });

    return Array.from(map.values()).sort((a, b) => b.totalAmt - a.totalAmt);
  }, [allDetailedItems, unitMap, cutoffDate, today]);

  function handleExportCsv() {
    if (activeReport === 'statement_summary') {
      downloadCsv(
        `estado-cuenta-resumido-${cutoffDate}.csv`,
        [
          'PERIODO',
          'ADMON',
          'INTERESES',
          'RETROACTIVO',
          'CUOTA EXTRA',
          'OTROS',
          'TOTAL COBRO MES',
          'AJUSTES',
          'PAGOS',
          'SALDO',
          'FECHA DE PAGO',
        ],
        summaryStatementRows.map(r => [
          r.period,
          r.admon,
          r.intereses,
          r.retroactivo,
          r.cuotaExtra,
          r.otros,
          r.totalCobro,
          r.ajustes,
          r.pagos,
          r.saldo,
          r.lastPaymentDate,
        ])
      );
    } else if (activeReport === 'statement_detailed') {
      downloadCsv(
        `estado-cuenta-detallado-${cutoffDate}.csv`,
        ['INMUEBLE', 'PROPIETARIO', 'NIT/CC', 'FECHA', 'DOCUMENTO', 'DETALLE', 'MOVIMIENTO', 'SALDO'],
        detailedStatementRows.map(r => [
          r.code,
          r.ownerName,
          r.docId,
          r.date,
          r.doc,
          r.detail,
          r.delta,
          r.balance,
        ])
      );
    } else if (activeReport === 'by_concept') {
      downloadCsv(
        `cartera-por-conceptos-${cutoffDate}.csv`,
        ['CODIGO', 'CONCEPTO', 'INMUEBLES', 'POR VENCER', 'VENCIDA', 'TOTAL CARTERA'],
        byConceptRows.map(r => [
          r.code,
          r.name,
          r.unitsCount,
          r.currentAmt,
          r.overdueAmt,
          r.totalAmt,
        ])
      );
    } else {
      downloadCsv(
        `cartera-por-edades-${cutoffDate}.csv`,
        [
          'INMUEBLE',
          'PROPIETARIO',
          'POR VENCER',
          '1-30 DIAS',
          '31-60 DIAS',
          '61-90 DIAS',
          '+90 DIAS',
          'TOTAL CARTERA',
        ],
        byAgingRows.map(r => [
          r.unitLabel,
          r.ownerName,
          r.currentAmt,
          r.d1_30,
          r.d31_60,
          r.d61_90,
          r.d90_plus,
          r.totalAmt,
        ])
      );
    }
  }

  function handlePrintReport() {
    const titleMap: Record<ReportKey, string> = {
      statement_summary: 'ESTADO DE CUENTA RESUMIDO',
      statement_detailed: 'ESTADO DE CUENTA DETALLADO',
      by_concept: 'CARTERA POR CONCEPTOS',
      by_aging: 'CARTERA POR EDADES',
    };

    const targetUnit = selectedUnitId ? unitMap.get(selectedUnitId) : null;
    const unitHeaderHtml = targetUnit
      ? `<p style="margin:4px 0 0 0;font-size:12px;"><strong>Inmueble:</strong> ${escapeHtml(unitLabelText(targetUnit))} &nbsp;|&nbsp; <strong>Propietario:</strong> ${escapeHtml(targetUnit.owner_name || '—')}</p>`
      : '';

    let tableHeaders: string[] = [];
    let tableRowsHtml = '';

    if (activeReport === 'statement_summary') {
      tableHeaders = [
        'Período',
        'Admon',
        'Intereses',
        'Retroactivo',
        'Cuota Extra',
        'Total Cobro',
        'Ajustes',
        'Pagos',
        'Saldo',
        'Fecha Pago',
      ];
      tableRowsHtml = summaryStatementRows
        .map(
          r => `<tr>
            <td>${escapeHtml(r.period)}</td>
            <td class="num">${escapeHtml(formatCOP(r.admon))}</td>
            <td class="num">${escapeHtml(formatCOP(r.intereses))}</td>
            <td class="num">${escapeHtml(formatCOP(r.retroactivo))}</td>
            <td class="num">${escapeHtml(formatCOP(r.cuotaExtra))}</td>
            <td class="num">${escapeHtml(formatCOP(r.totalCobro))}</td>
            <td class="num">${escapeHtml(formatCOP(r.ajustes))}</td>
            <td class="num">${escapeHtml(formatCOP(r.pagos))}</td>
            <td class="num"><strong>${escapeHtml(formatCOP(r.saldo))}</strong></td>
            <td>${escapeHtml(r.lastPaymentDate || '—')}</td>
          </tr>`
        )
        .join('');
    } else if (activeReport === 'statement_detailed') {
      tableHeaders = ['Fecha', 'Documento', 'Detalle', 'Movimiento', 'Saldo'];
      tableRowsHtml = detailedStatementRows
        .map(
          r => `<tr>
            <td>${escapeHtml(r.date)}</td>
            <td>${escapeHtml(r.doc)}</td>
            <td>${escapeHtml(r.detail)}</td>
            <td class="num">${escapeHtml(formatCOP(r.delta))}</td>
            <td class="num"><strong>${escapeHtml(formatCOP(r.balance))}</strong></td>
          </tr>`
        )
        .join('');
    } else if (activeReport === 'by_concept') {
      tableHeaders = ['Código', 'Concepto', 'Inmuebles', 'Por Vencer', 'Vencida', 'Total'];
      tableRowsHtml = byConceptRows
        .map(
          r => `<tr>
            <td>${escapeHtml(r.code)}</td>
            <td>${escapeHtml(r.name)}</td>
            <td class="num">${r.unitsCount}</td>
            <td class="num">${escapeHtml(formatCOP(r.currentAmt))}</td>
            <td class="num">${escapeHtml(formatCOP(r.overdueAmt))}</td>
            <td class="num"><strong>${escapeHtml(formatCOP(r.totalAmt))}</strong></td>
          </tr>`
        )
        .join('');
    } else {
      tableHeaders = [
        'Inmueble',
        'Propietario',
        'Por Vencer',
        '1-30 Días',
        '31-60 Días',
        '61-90 Días',
        '+90 Días',
        'Total',
      ];
      tableRowsHtml = byAgingRows
        .map(
          r => `<tr>
            <td>${escapeHtml(r.unitLabel)}</td>
            <td>${escapeHtml(r.ownerName)}</td>
            <td class="num">${escapeHtml(formatCOP(r.currentAmt))}</td>
            <td class="num">${escapeHtml(formatCOP(r.d1_30))}</td>
            <td class="num">${escapeHtml(formatCOP(r.d31_60))}</td>
            <td class="num">${escapeHtml(formatCOP(r.d61_90))}</td>
            <td class="num">${escapeHtml(formatCOP(r.d90_plus))}</td>
            <td class="num"><strong>${escapeHtml(formatCOP(r.totalAmt))}</strong></td>
          </tr>`
        )
        .join('');
    }

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>${escapeHtml(titleMap[activeReport])}</title><style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 24px; color: #111827; }
      h1 { font-size: 16px; margin: 0; }
      .sub { font-size: 12px; color: #4b5563; margin-top: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 11px; }
      th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }
      th { background: #f3f4f6; font-weight: 700; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
    </style></head><body>
      <h1>${escapeHtml(activeOrg?.name || 'Copropiedad')} — ${escapeHtml(titleMap[activeReport])}</h1>
      <div class="sub">Fecha de corte: ${escapeHtml(cutoffDate)}</div>
      ${unitHeaderHtml}
      <table>
        <thead><tr>${tableHeaders.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${tableRowsHtml || `<tr><td colspan="${tableHeaders.length}">Sin registros</td></tr>`}</tbody>
      </table>
    </body></html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument || win?.document;
    if (doc && win) {
      doc.open();
      doc.write(html);
      doc.close();
      win.focus();
      setTimeout(() => {
        win.print();
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 500);
      }, 150);
    }
  }

  if (!activeOrg) return <NoOrgSelected />;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-600" />
        <p className="text-sm text-red-700">{errorMsg}</p>
      </div>
    );
  }

  const requiresSingleUnit =
    activeReport === 'statement_summary' || activeReport === 'statement_detailed';
  const activeUnitObj = selectedUnitId ? unitMap.get(selectedUnitId) : null;

  return (
    <div className="space-y-6">
      {/* Selector de Reporte + Acciones */}
      <Card>
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                MOD-07 · Reportes de Cartera
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Consultas, estados de cuenta y análisis de cartera a fecha de corte.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleExportCsv}>
                <Download className="w-4 h-4 mr-1" /> Exportar CSV
              </Button>
              <Button type="button" size="sm" onClick={handlePrintReport}>
                <Printer className="w-4 h-4 mr-1" /> Imprimir
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveReport('statement_summary')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
                activeReport === 'statement_summary'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" /> Estado de Cuenta Resumido
            </button>
            <button
              type="button"
              onClick={() => setActiveReport('statement_detailed')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
                activeReport === 'statement_detailed'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <FileText className="w-3.5 h-3.5" /> Estado de Cuenta Detallado
            </button>
            <button
              type="button"
              onClick={() => setActiveReport('by_concept')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
                activeReport === 'by_concept'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" /> Cartera por Conceptos
            </button>
            <button
              type="button"
              onClick={() => setActiveReport('by_aging')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
                activeReport === 'by_aging'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> Cartera por Edades
            </button>
          </div>

          {/* Filtros compartidos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end pt-1">
            <Input
              label="Fecha de corte *"
              type="date"
              value={cutoffDate}
              onChange={e => setCutoffDate(e.target.value)}
            />

            <Input
              label="Desde (recaudo)"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
            />

            <Input
              label="Hasta (recaudo)"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
            />

            <Select
              label="Agrupación / Torre"
              value={selectedTower}
              onChange={e => setSelectedTower(e.target.value)}
            >
              <option value="ALL">Todas las agrupaciones</option>
              {towers.map(t => (
                <option key={t} value={t}>
                  Torre / Bloque {t}
                </option>
              ))}
            </Select>

            <Select
              label="Inmueble"
              value={selectedUnitId}
              onChange={e => setSelectedUnitId(e.target.value)}
            >
              <option value="">
                {requiresSingleUnit ? '— Seleccione un inmueble —' : 'Todos los inmuebles'}
              </option>
              {units.map(u => (
                <option key={u.id} value={u.id}>
                  {unitLabelText(u)}
                </option>
              ))}
            </Select>

            <Select
              label="Concepto"
              value={selectedConceptId}
              onChange={e => setSelectedConceptId(e.target.value)}
            >
              <option value="ALL">Todos los conceptos</option>
              {concepts.map(c => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium text-gray-500 uppercase">Cartera Total</p>
            <p className="text-lg font-bold text-gray-900 mt-1">
              {formatCOP(kpis.totalPortfolio)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium text-gray-500 uppercase">Cartera Vencida</p>
            <p className="text-lg font-bold text-red-700 mt-1">
              {formatCOP(kpis.overduePortfolio)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium text-gray-500 uppercase">Recaudo en Rango</p>
            <p className="text-lg font-bold text-emerald-700 mt-1">
              {formatCOP(kpis.collectedInRange)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium text-gray-500 uppercase">Anticipos / Saldos a Favor</p>
            <p className="text-lg font-bold text-blue-700 mt-1">
              {formatCOP(kpis.advanceTotal)}
            </p>
          </div>
        </Card>
      </div>

      {/* Contenido del reporte seleccionado */}
      <Card>
        <div className="p-6">
          {requiresSingleUnit && !selectedUnitId ? (
            <div className="text-center py-10 text-sm text-gray-500">
              Seleccione un <strong>Inmueble</strong> en los filtros para visualizar el estado de cuenta.
            </div>
          ) : activeReport === 'statement_summary' ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3.5 text-xs flex flex-wrap justify-between gap-2">
                <div>
                  <span className="text-gray-500">INMUEBLE: </span>
                  <strong className="text-gray-900">{unitLabelText(activeUnitObj)}</strong>
                </div>
                <div>
                  <span className="text-gray-500">PROPIETARIO / RESPONSABLE: </span>
                  <strong className="text-gray-900">{activeUnitObj?.owner_name || '—'}</strong>
                </div>
                <div>
                  <span className="text-gray-500">CORTE: </span>
                  <strong className="text-gray-900">{cutoffDate}</strong>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                    <tr>
                      <th className="px-3 py-2.5">Período</th>
                      <th className="px-3 py-2.5 text-right">Admon</th>
                      <th className="px-3 py-2.5 text-right">Intereses</th>
                      <th className="px-3 py-2.5 text-right">Retroactivo</th>
                      <th className="px-3 py-2.5 text-right">Cuota Extra</th>
                      <th className="px-3 py-2.5 text-right">Total Cobro Mes</th>
                      <th className="px-3 py-2.5 text-right">Ajustes</th>
                      <th className="px-3 py-2.5 text-right">Pagos</th>
                      <th className="px-3 py-2.5 text-right">Saldo</th>
                      <th className="px-3 py-2.5">Fecha de Pago</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {summaryStatementRows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                          No hay movimientos registrados para este inmueble a la fecha de corte.
                        </td>
                      </tr>
                    ) : (
                      summaryStatementRows.map(r => (
                        <tr key={r.period} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono font-medium text-gray-900">
                            {r.period}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{formatCOP(r.admon)}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatCOP(r.intereses)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatCOP(r.retroactivo)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatCOP(r.cuotaExtra)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">
                            {formatCOP(r.totalCobro)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatCOP(r.ajustes)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-700">
                            {formatCOP(r.pagos)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">
                            {formatCOP(r.saldo)}
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {r.lastPaymentDate || '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeReport === 'statement_detailed' ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3.5 text-xs flex flex-wrap justify-between gap-2">
                <div>
                  <span className="text-gray-500">COPROPIEDAD: </span>
                  <strong className="text-gray-900">{activeOrg.name}</strong>
                </div>
                <div>
                  <span className="text-gray-500">INMUEBLE: </span>
                  <strong className="text-gray-900">{unitLabelText(activeUnitObj)}</strong>
                </div>
                <div>
                  <span className="text-gray-500">PROPIETARIO: </span>
                  <strong className="text-gray-900">{activeUnitObj?.owner_name || '—'}</strong>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                    <tr>
                      <th className="px-3 py-2.5">Fecha</th>
                      <th className="px-3 py-2.5">Documento</th>
                      <th className="px-3 py-2.5">Detalle</th>
                      <th className="px-3 py-2.5 text-right">Movimiento</th>
                      <th className="px-3 py-2.5 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {detailedStatementRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                          No hay movimientos detallados para este inmueble a la fecha de corte.
                        </td>
                      </tr>
                    ) : (
                      detailedStatementRows.map((r, idx) => (
                        <tr key={`${r.doc}-${idx}`} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono text-gray-700">{r.date || '—'}</td>
                          <td className="px-3 py-2 font-mono font-semibold text-blue-700">
                            {r.doc}
                          </td>
                          <td className="px-3 py-2 text-gray-800">{r.detail}</td>
                          <td
                            className={`px-3 py-2 text-right font-mono font-medium ${
                              r.delta < 0 ? 'text-emerald-700' : 'text-gray-900'
                            }`}
                          >
                            {formatCOP(r.delta)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">
                            {formatCOP(r.balance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeReport === 'by_concept' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Código</th>
                    <th className="px-3 py-2.5">Concepto</th>
                    <th className="px-3 py-2.5 text-right">Inmuebles</th>
                    <th className="px-3 py-2.5 text-right">Por Vencer</th>
                    <th className="px-3 py-2.5 text-right">Vencida</th>
                    <th className="px-3 py-2.5 text-right">Total Cartera</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {byConceptRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                        No hay saldos pendientes por concepto con los filtros actuales.
                      </td>
                    </tr>
                  ) : (
                    byConceptRows.map(r => (
                      <tr key={r.conceptId} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-gray-700">{r.code}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                        <td className="px-3 py-2 text-right font-mono">{r.unitsCount}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCOP(r.currentAmt)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-red-700">
                          {formatCOP(r.overdueAmt)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">
                          {formatCOP(r.totalAmt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Inmueble</th>
                    <th className="px-3 py-2.5">Propietario</th>
                    <th className="px-3 py-2.5 text-right">Por Vencer</th>
                    <th className="px-3 py-2.5 text-right">1–30 Días</th>
                    <th className="px-3 py-2.5 text-right">31–60 Días</th>
                    <th className="px-3 py-2.5 text-right">61–90 Días</th>
                    <th className="px-3 py-2.5 text-right">+90 Días</th>
                    <th className="px-3 py-2.5 text-right">Total Cartera</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {byAgingRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                        No hay cartera pendiente para mostrar por edades.
                      </td>
                    </tr>
                  ) : (
                    byAgingRows.map(r => (
                      <tr key={r.unitId} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-medium text-gray-900">
                          {r.unitLabel}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{r.ownerName}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCOP(r.currentAmt)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{formatCOP(r.d1_30)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatCOP(r.d31_60)}</td>
                        <td className="px-3 py-2 text-right font-mono text-amber-700">
                          {formatCOP(r.d61_90)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-red-700">
                          {formatCOP(r.d90_plus)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">
                          {formatCOP(r.totalAmt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}