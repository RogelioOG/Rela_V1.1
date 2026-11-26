import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Printer,
  Receipt,
  Scale,
  Table as TableIcon,
  Wallet,
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
  | 'by_aging'
  | 'receipts_list'
  | 'collection_summary'
  | 'advances'
  | 'paz_y_salvo'
  | 'treasury_notes'
  | 'delinquency';

interface PaymentMethodOption {
  id: string;
  name: string;
}

interface ThirdPartyOption {
  id: string;
  name: string;
  document_number?: string | null;
}

interface ConceptColumnDef {
  key: string;
  label: string;
  conceptId?: string;
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
  if (!dueDateStr || !cutoffDateStr) return 0;
  const due = new Date(`${dueDateStr.slice(0, 10)}T00:00:00`);
  const cut = new Date(`${cutoffDateStr.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime()) || Number.isNaN(cut.getTime())) return 0;
  return Math.floor((cut.getTime() - due.getTime()) / 86400000);
}

function classifyConcept(
  code?: string | null,
  name?: string | null,
  isLateInterest?: boolean
): 'admon' | 'intereses' | 'retroactivo' | 'cuotaExtra' | 'other' {
  const c = String(code || '').toUpperCase().trim();
  const n = String(name || '').toUpperCase().trim();
  if (isLateInterest || c.startsWith('MORA') || n.includes('INTERES')) {
    return 'intereses';
  }
  if (c === 'REA' || n.includes('RETRO')) {
    return 'retroactivo';
  }
  if (c === 'EXT' || n.includes('EXTRAORDINARIA') || n.includes('CUOTA EXTRA')) {
    return 'cuotaExtra';
  }
  if (c === 'ADM' || n.includes('ADMINISTRACI') || n.includes('ADMON')) {
    return 'admon';
  }
  return 'other';
}

function noteLineSignedDelta(parentNote: any, line: any): number {
  const val = roundMoney(
    Number(line?.amount || 0) +
      Number(line?.discount_amount || 0) +
      Number(line?.advance_amount || 0)
  );
  if (val === 0) return 0;

  const noteType = String(parentNote?.note_type || '').toUpperCase().trim();
  const section = String(line?.section || '').toLowerCase().trim();

  if (section === 'abono') return -Math.abs(val);
  if (section === 'cargo') return Math.abs(val);

  if (noteType === 'ND') return Math.abs(val);
  if (noteType === 'NC') return -Math.abs(val);
  return 0;
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

const REPORT_TABS: { key: ReportKey; label: string; icon: any }[] = [
  { key: 'statement_summary', label: 'Estado de Cuenta Resumido', icon: TableIcon },
  { key: 'statement_detailed', label: 'Estado de Cuenta Detallado', icon: FileText },
  { key: 'by_concept', label: 'Cartera por Conceptos', icon: Layers },
  { key: 'by_aging', label: 'Cartera por Edades', icon: FileSpreadsheet },
  { key: 'receipts_list', label: 'Relación de Recibos', icon: Receipt },
  { key: 'collection_summary', label: 'Recaudo Fecha / Medio', icon: CreditCard },
  { key: 'advances', label: 'Saldos a Favor / Anticipos', icon: Wallet },
  { key: 'paz_y_salvo', label: 'Paz y Salvo', icon: CheckCircle2 },
  { key: 'treasury_notes', label: 'Notas NC / ND / NT', icon: Scale },
  { key: 'delinquency', label: 'Cartera Morosa', icon: AlertTriangle },
];

export function PortfolioReportsTab() {
  const { activeOrg } = useOrg();
  const today = todayISO();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [activeReport, setActiveReport] = useState<ReportKey>('statement_summary');
  const [cutoffDate, setCutoffDate] = useState<string>(today);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [selectedTower, setSelectedTower] = useState<string>('ALL');
  const [selectedConceptId, setSelectedConceptId] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const [units, setUnits] = useState<Unit[]>([]);
  const [concepts, setConcepts] = useState<BillingConcept[]>([]);
  const [hierarchy, setHierarchy] = useState<PaymentHierarchyConfig[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [thirdParties, setThirdParties] = useState<ThirdPartyOption[]>([]);
  const [dues, setDues] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [receiptAllocations, setReceiptAllocations] = useState<any[]>([]);
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
      allocRes,
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
      supabase.from('receipt_allocations').select('*'),
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
    setReceiptAllocations(allocRes.data || []);
    setNotes(notesRes.data || []);
    setNoteLines(noteLinesRes.data || []);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const isDateAllowed = useCallback(
    (docDateStr?: string | null) => {
      const dt = String(docDateStr || '').slice(0, 10);
      if (!dt) return true;
      if (dateFrom && dt < dateFrom) return false;
      if (dateTo && dt > dateTo) return false;
      if (!dateFrom && !dateTo && cutoffDate && dt > cutoffDate) return false;
      return true;
    },
    [cutoffDate, dateFrom, dateTo]
  );

  const effectiveCutoff = useMemo(() => {
    return dateTo || cutoffDate || today;
  }, [dateTo, cutoffDate, today]);

  const isStatusAllowed = useCallback(
    (st?: string | null) => {
      const status = String(st || 'pendiente').toLowerCase();
      if (statusFilter === 'ALL') {
        return status !== 'anulado' && status !== 'void';
      }
      return status === statusFilter.toLowerCase();
    },
    [statusFilter]
  );

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

  const activeConceptById = useMemo(() => {
    const m = new Map<string, BillingConcept>();
    concepts.forEach(c => {
      if (c.is_active !== false) {
        m.set(String(c.id), c);
      }
    });
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

  const dueByIdMap = useMemo(() => {
    const m = new Map<string, any>();
    dues.forEach(d => m.set(String(d.id), d));
    return m;
  }, [dues]);

  const receiptByIdMap = useMemo(() => {
    const m = new Map<string, any>();
    receipts.forEach(r => m.set(String(r.id), r));
    return m;
  }, [receipts]);

  const noteByIdMap = useMemo(() => {
    const m = new Map<string, any>();
    notes.forEach(n => m.set(String(n.id), n));
    return m;
  }, [notes]);

  const allocsByReceiptId = useMemo(() => {
    const m = new Map<string, any[]>();
    receiptAllocations.forEach(al => {
      const rid = String(al.receipt_id || '');
      if (!m.has(rid)) m.set(rid, []);
      m.get(rid)!.push(al);
    });
    return m;
  }, [receiptAllocations]);

  const getInvoiceBaseConceptAmounts = useCallback(
    (inv: any) => {
      const uid = String(inv.unit_id || '');
      const period = String(inv.period || '');
      const snapItems = Array.isArray(inv.items_snapshot) ? inv.items_snapshot : [];

      const restoredByConcept = new Map<string, number>();

      receiptAllocations.forEach(al => {
        const rec = receiptByIdMap.get(String(al.receipt_id || ''));
        if (!rec || !isStatusAllowed(rec.status)) return;
        const dueObj = al.due_id ? dueByIdMap.get(String(al.due_id)) : null;
        const alUnit = String(dueObj?.unit_id || rec.unit_id || '');
        const alPeriod = String(dueObj?.period || al.period || '');
        if (alUnit === uid && alPeriod === period) {
          const cid = String(al.concept_id || '');
          const applied = roundMoney(
            Number(al.capital_applied || 0) +
              Number(al.interest_applied || 0) +
              Number(al.discount_applied || 0)
          );
          if (cid && applied > 0) {
            restoredByConcept.set(cid, roundMoney((restoredByConcept.get(cid) || 0) + applied));
          }
        }
      });

      noteLines.forEach(ln => {
        const parent = noteByIdMap.get(String(ln.note_id || ''));
        if (!parent || !isStatusAllowed(parent.status)) return;
        const dueObj = ln.due_id ? dueByIdMap.get(String(ln.due_id)) : null;
        const lnUnit = String(ln.unit_id || dueObj?.unit_id || parent.unit_id || '');
        const lnPeriod = String(ln.period || dueObj?.period || '');
        if (lnUnit === uid && lnPeriod === period) {
          const cid = String(ln.concept_id || ln.conceptId || '');
          const delta = noteLineSignedDelta(parent, ln);
          if (cid && Math.abs(delta) > 0) {
            restoredByConcept.set(cid, roundMoney((restoredByConcept.get(cid) || 0) - delta));
          }
        }
      });

      const result: {
        conceptId?: string;
        code: string;
        name: string;
        baseAmount: number;
        isLateInterest: boolean;
      }[] = [];

      if (snapItems.length > 0) {
        snapItems.forEach((it: any) => {
          const cid = String(it.conceptId ?? it.concept_id ?? it.billing_concept_id ?? '');
          const cObj = cid ? conceptMap.get(cid) : undefined;
          const currentSnapAmt = roundMoney(Number(it.amount ?? it.total ?? it.value ?? 0));
          const restoredDelta = cid ? roundMoney(restoredByConcept.get(cid) || 0) : 0;
          const originalAmt = roundMoney(Math.max(currentSnapAmt + restoredDelta, 0));

          result.push({
            conceptId: cid || undefined,
            code: cObj?.code || String(it.conceptCode ?? it.concept_code ?? ''),
            name:
              cObj?.name ||
              String(it.conceptName ?? it.concept_name ?? it.name ?? 'Concepto'),
            baseAmount: originalAmt,
            isLateInterest: Boolean(
              cObj?.is_late_interest ?? it.isLateInterest ?? it.is_late_interest
            ),
          });
        });

        const intr = roundMoney(Number(inv.interest_amount || 0));
        const hasInterestInSnap = result.some(
          r => classifyConcept(r.code, r.name, r.isLateInterest) === 'intereses'
        );
        if (intr > 0 && !hasInterestInSnap) {
          const moraConcept = concepts.find(c => c.is_late_interest);
          result.push({
            conceptId: moraConcept?.id ? String(moraConcept.id) : undefined,
            code: moraConcept?.code || 'MORA_ADM',
            name: moraConcept?.name || 'Intereses de Mora',
            baseAmount: intr,
            isLateInterest: true,
          });
        }
      } else {
        const sub = roundMoney(Number(inv.subtotal || 0));
        const intr = roundMoney(Number(inv.interest_amount || 0));
        if (sub > 0) {
          const admConcept = concepts.find(
            c =>
              !c.is_late_interest &&
              classifyConcept(c.code, c.name, false) === 'admon'
          );
          result.push({
            conceptId: admConcept?.id ? String(admConcept.id) : undefined,
            code: admConcept?.code || 'ADM',
            name: admConcept?.name || 'Cuota de Administración',
            baseAmount: sub,
            isLateInterest: false,
          });
        }
        if (intr > 0) {
          const moraConcept = concepts.find(c => c.is_late_interest);
          result.push({
            conceptId: moraConcept?.id ? String(moraConcept.id) : undefined,
            code: moraConcept?.code || 'MORA_ADM',
            name: moraConcept?.name || 'Intereses de Mora',
            baseAmount: intr,
            isLateInterest: true,
          });
        }
      }

      return result;
    },
    [
      conceptMap,
      concepts,
      receiptAllocations,
      receiptByIdMap,
      dueByIdMap,
      noteLines,
      noteByIdMap,
      isStatusAllowed,
    ]
  );

  const allDetailedItems = useMemo(() => {
    const items: (DetailedDueItem & { unitId: string })[] = [];
    const duesByUnit = new Map<string, any[]>();
    const invByUnit = new Map<string, Record<string, any>>();

    dues.forEach(d => {
      const uid = String(d.unit_id || '');
      if (!allowedUnitIds.has(uid)) return;
      if (!isStatusAllowed(d.status)) return;
      if (!isDateAllowed(d.due_date || d.period_start)) return;
      if (!duesByUnit.has(uid)) duesByUnit.set(uid, []);
      duesByUnit.get(uid)!.push(d);
    });

    invoices.forEach(inv => {
      const uid = String(inv.unit_id || '');
      if (!allowedUnitIds.has(uid)) return;
      if (!isStatusAllowed(inv.status)) return;
      if (!isDateAllowed(inv.issue_date || inv.due_date)) return;
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
        effectiveCutoff,
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
    isStatusAllowed,
    isDateAllowed,
    hierarchy,
    concepts,
    effectiveCutoff,
    selectedConceptId,
  ]);

  // 1. Estado de Cuenta Resumido
  const summaryStatementData = useMemo(() => {
    const targetUnitId =
      selectedUnitId || (filteredUnits.length === 1 ? String(filteredUnits[0].id) : '');
    if (!targetUnitId) {
      return { rows: [] as any[], hasAnyDiscount: false };
    }

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
        descuento: number;
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
          descuento: 0,
          saldo: 0,
          lastPaymentDate: '',
        });
      }
      return byPeriod.get(periodKey)!;
    };

    const addDiscriminatedAmount = (
      row: ReturnType<typeof getOrCreate>,
      conceptId: string | null | undefined,
      fallbackCode: string,
      fallbackName: string,
      val: number,
      isLateInterest = false
    ) => {
      const amount = roundMoney(val);
      if (Math.abs(amount) < 0.005) return;
      if (selectedConceptId !== 'ALL' && String(conceptId || '') !== selectedConceptId) {
        return;
      }
      const cObj = conceptId ? conceptMap.get(String(conceptId)) : undefined;
      const cat = classifyConcept(
        cObj?.code || fallbackCode,
        cObj?.name || fallbackName,
        Boolean(cObj?.is_late_interest || isLateInterest)
      );
      if (cat === 'intereses') row.intereses = roundMoney(row.intereses + amount);
      else if (cat === 'retroactivo') row.retroactivo = roundMoney(row.retroactivo + amount);
      else if (cat === 'cuotaExtra') row.cuotaExtra = roundMoney(row.cuotaExtra + amount);
      else if (cat === 'admon') row.admon = roundMoney(row.admon + amount);
      else row.otros = roundMoney(row.otros + amount);
    };

    invoices
      .filter(
        inv =>
          String(inv.unit_id) === targetUnitId &&
          isStatusAllowed(inv.status) &&
          isDateAllowed(inv.issue_date || inv.due_date)
      )
      .forEach(inv => {
        const p = String(inv.period || 'SIN PERIODO');
        const row = getOrCreate(p);
        const baseLines = getInvoiceBaseConceptAmounts(inv);
        baseLines.forEach(line => {
          addDiscriminatedAmount(
            row,
            line.conceptId,
            line.code,
            line.name,
            line.baseAmount,
            line.isLateInterest
          );
        });
      });

    dues
      .filter(
        d =>
          String(d.unit_id) === targetUnitId &&
          isStatusAllowed(d.status) &&
          isDateAllowed(d.due_date || d.period_start)
      )
      .forEach(d => {
        const p = String(d.period || 'SIN PERIODO');
        const row = getOrCreate(p);
        const hasInvoiceForPeriod = invoices.some(
          inv =>
            String(inv.unit_id) === targetUnitId &&
            String(inv.period || '') === p &&
            isStatusAllowed(inv.status) &&
            isDateAllowed(inv.issue_date || inv.due_date)
        );
        const dueAmt = Number(d.amount ?? d.base_amount ?? 0);
        if (!hasInvoiceForPeriod && dueAmt > 0) {
          addDiscriminatedAmount(
            row,
            d.conceptId ?? d.concept_id ?? d.billing_concept_id ?? null,
            d.conceptCode ?? d.concept_code ?? 'ADM',
            d.conceptName ?? d.concept_name ?? 'Cuota de Administración',
            dueAmt,
            false
          );
        }
      });

    receipts
      .filter(
        r =>
          String(r.unit_id) === targetUnitId &&
          isStatusAllowed(r.status) &&
          isDateAllowed(r.payment_date || r.accounting_date)
      )
      .forEach(r => {
        const dt = String(r.payment_date || r.accounting_date || '');
        const rAllocs = allocsByReceiptId.get(String(r.id)) || [];

        if (rAllocs.length > 0) {
          rAllocs.forEach(al => {
            if (
              selectedConceptId !== 'ALL' &&
              String(al.concept_id || '') !== selectedConceptId
            ) {
              return;
            }
            const dueObj = al.due_id ? dueByIdMap.get(String(al.due_id)) : null;
            const pKey = String(
              dueObj?.period || al.period || (dt ? dt.slice(0, 7) : 'GENERAL')
            );
            const target = getOrCreate(pKey);
            const paidAmt = roundMoney(
              Number(al.capital_applied || 0) + Number(al.interest_applied || 0)
            );
            const discAmt = roundMoney(Number(al.discount_applied || 0));
            target.pagos = roundMoney(target.pagos - paidAmt);
            target.descuento = roundMoney(target.descuento - discAmt);
            if (dt && (!target.lastPaymentDate || dt > target.lastPaymentDate)) {
              target.lastPaymentDate = dt;
            }
          });
        } else if (selectedConceptId === 'ALL') {
          const pKey = dt ? dt.slice(0, 7) : 'GENERAL';
          const target = byPeriod.has(pKey)
            ? byPeriod.get(pKey)!
            : Array.from(byPeriod.values()).slice(-1)[0] || getOrCreate(pKey);
          const amt = Number(r.total_amount || 0);
          target.pagos = roundMoney(target.pagos - amt);
          if (dt && (!target.lastPaymentDate || dt > target.lastPaymentDate)) {
            target.lastPaymentDate = dt;
          }
        }
      });

    noteLines.forEach(ln => {
      const parent = noteByIdMap.get(String(ln.note_id));
      if (!parent || !isStatusAllowed(parent.status)) return;
      const lineUnit = String(ln.unit_id || parent.unit_id || '');
      if (lineUnit !== targetUnitId) return;
      if (!isDateAllowed(parent.accounting_date || parent.application_date)) return;
      const cid = String(ln.conceptId ?? ln.concept_id ?? '');
      if (selectedConceptId !== 'ALL' && cid !== selectedConceptId) {
        return;
      }

      const dueObj = ln.due_id ? dueByIdMap.get(String(ln.due_id)) : null;
      const pKey = String(
        dueObj?.period ||
          ln.period ||
          (parent.accounting_date ? parent.accounting_date.slice(0, 7) : 'GENERAL')
      );
      const target = getOrCreate(pKey);
      const delta = noteLineSignedDelta(parent, ln);
      target.ajustes = roundMoney(target.ajustes + delta);
    });

    const sorted = Array.from(byPeriod.values()).sort((a, b) =>
      a.period.localeCompare(b.period)
    );

    let runningSaldo = 0;
    let hasAnyDiscount = false;
    const rows = sorted.map(r => {
      const totalCobro = roundMoney(
        r.admon + r.intereses + r.retroactivo + r.cuotaExtra + r.otros
      );
      if (Math.abs(r.descuento) >= 0.005) {
        hasAnyDiscount = true;
      }
      const netPeriod = roundMoney(totalCobro + r.ajustes + r.pagos + r.descuento);
      runningSaldo = roundMoney(runningSaldo + netPeriod);
      return {
        ...r,
        totalCobro,
        saldo: runningSaldo,
      };
    });

    return { rows, hasAnyDiscount };
  }, [
    selectedUnitId,
    filteredUnits,
    invoices,
    dues,
    receipts,
    allocsByReceiptId,
    dueByIdMap,
    noteByIdMap,
    noteLines,
    conceptMap,
    getInvoiceBaseConceptAmounts,
    isStatusAllowed,
    isDateAllowed,
    selectedConceptId,
  ]);

  const summaryStatementRows = summaryStatementData.rows;
  const hasSummaryDiscount = summaryStatementData.hasAnyDiscount;

  // 2. Estado de Cuenta Detallado
  const detailedStatementData = useMemo(() => {
    const targetUnitId =
      selectedUnitId || (filteredUnits.length === 1 ? String(filteredUnits[0].id) : '');
    if (!targetUnitId) {
      return {
        columns: [] as ConceptColumnDef[],
        rows: [] as any[],
        finalTotalDoc: 0,
        finalConceptTotals: {} as Record<string, number>,
        finalBalance: 0,
      };
    }

    const uObj = unitMap.get(targetUnitId);
    const tpObj = uObj?.third_party_id ? tpMap.get(String(uObj.third_party_id)) : null;

    const rawEvents: {
      date: string;
      doc: string;
      detail: string;
      totalDoc: number;
      discountApplied: number;
      byConceptKey: Record<string, number>;
    }[] = [];

    const candidateCols = new Map<string, ConceptColumnDef>();

    const addMovementToConcept = (
      eventMap: Record<string, number>,
      colKey: string,
      label: string,
      conceptId: string | undefined,
      amount: number
    ) => {
      const rounded = roundMoney(amount);
      if (Math.abs(rounded) < 0.005) return;
      if (conceptId && activeConceptById.size > 0 && !activeConceptById.has(conceptId)) return;

      if (!candidateCols.has(colKey)) {
        candidateCols.set(colKey, {
          key: colKey,
          label,
          conceptId,
        });
      }
      eventMap[colKey] = roundMoney((eventMap[colKey] || 0) + rounded);
    };

    // 2.1 Cuentas de cobro originales
    invoices
      .filter(
        inv =>
          String(inv.unit_id) === targetUnitId &&
          isStatusAllowed(inv.status) &&
          isDateAllowed(inv.issue_date || inv.due_date)
      )
      .forEach(inv => {
        const byConceptKey: Record<string, number> = {};
        const baseLines = getInvoiceBaseConceptAmounts(inv);

        baseLines.forEach(line => {
          const cid = line.conceptId ? String(line.conceptId) : '';
          if (cid && activeConceptById.size > 0 && !activeConceptById.has(cid)) return;
          if (selectedConceptId !== 'ALL' && cid !== selectedConceptId) return;

          const cObj = cid ? activeConceptById.get(cid) || conceptMap.get(cid) : undefined;
          const label = cObj?.name || line.name || 'Concepto';
          const key = cid ? `cid_${cid}` : `lbl_${label.toUpperCase()}`;
          addMovementToConcept(byConceptKey, key, label, cid || undefined, line.baseAmount);
        });

        const totalDoc = roundMoney(
          Object.values(byConceptKey).reduce((s, v) => s + v, 0)
        );

        if (selectedConceptId === 'ALL' || Math.abs(totalDoc) > 0) {
          rawEvents.push({
            date: String(inv.issue_date || inv.due_date || ''),
            doc: String(inv.invoice_number || `CC-${inv.period || ''}`),
            detail: `Cuenta de cobro período ${inv.period || ''}`,
            totalDoc,
            discountApplied: 0,
            byConceptKey,
          });
        }
      });

    // 2.2 Recibos de caja
    receipts
      .filter(
        r =>
          String(r.unit_id) === targetUnitId &&
          isStatusAllowed(r.status) &&
          isDateAllowed(r.payment_date || r.accounting_date)
      )
      .forEach(r => {
        const amt = roundMoney(Number(r.total_amount || 0));
        const pmName = r.payment_method_id ? pmMap.get(String(r.payment_method_id)) : '';
        const byConceptKey: Record<string, number> = {};
        const rAllocs = allocsByReceiptId.get(String(r.id)) || [];

        let receiptDiscount = 0;

        if (rAllocs.length > 0) {
          rAllocs.forEach(al => {
            const cid = String(al.concept_id || '');
            if (cid && activeConceptById.size > 0 && !activeConceptById.has(cid)) return;
            if (selectedConceptId !== 'ALL' && cid !== selectedConceptId) return;

            const paidVal = roundMoney(
              Number(al.capital_applied || 0) + Number(al.interest_applied || 0)
            );
            const discVal = roundMoney(Number(al.discount_applied || 0));
            receiptDiscount = roundMoney(receiptDiscount - discVal);

            if (Math.abs(paidVal) >= 0.005) {
              const cObj = cid ? activeConceptById.get(cid) || conceptMap.get(cid) : undefined;
              const label = cObj?.name || 'Concepto';
              const key = cid ? `cid_${cid}` : `lbl_${label.toUpperCase()}`;
              addMovementToConcept(byConceptKey, key, label, cid || undefined, -paidVal);
            }
          });
        } else if (selectedConceptId === 'ALL') {
          addMovementToConcept(byConceptKey, 'lbl_RECAUDO', 'Recaudo / Pago', undefined, -Math.abs(amt));
        }

        const adv = roundMoney(Number(r.advance_amount || 0));
        if (adv > 0 && selectedConceptId === 'ALL') {
          const advCid = r.advance_concept_id ? String(r.advance_concept_id) : '';
          const advConcept = advCid ? activeConceptById.get(advCid) || conceptMap.get(advCid) : undefined;
          const advLabel = advConcept?.name || 'Anticipo / Saldo a Favor';
          const advKey = advCid ? `cid_${advCid}` : 'lbl_ANTICIPO';
          addMovementToConcept(byConceptKey, advKey, advLabel, advCid || undefined, -adv);
        }

        const totalDoc =
          rAllocs.length > 0 && selectedConceptId === 'ALL'
            ? -Math.abs(amt)
            : roundMoney(Object.values(byConceptKey).reduce((s, v) => s + v, 0) || -Math.abs(amt));

        if (selectedConceptId === 'ALL' || Math.abs(totalDoc) > 0 || Math.abs(receiptDiscount) > 0) {
          rawEvents.push({
            date: String(r.payment_date || r.accounting_date || ''),
            doc: String(r.receipt_number || 'RC'),
            detail: `Recibo de caja${pmName ? ` (${pmName})` : ''}${r.notes ? ` · ${r.notes}` : ''}`,
            totalDoc,
            discountApplied: receiptDiscount,
            byConceptKey,
          });
        }
      });

    // 2.3 Notas (NC, ND, NT)
    const linesByNote = new Map<string, any[]>();
    noteLines.forEach(ln => {
      const nid = String(ln.note_id || '');
      if (!linesByNote.has(nid)) linesByNote.set(nid, []);
      linesByNote.get(nid)!.push(ln);
    });

    notes
      .filter(parent => {
        if (!isStatusAllowed(parent.status)) return false;
        if (!isDateAllowed(parent.accounting_date || parent.application_date)) return false;
        const nLines = linesByNote.get(String(parent.id)) || [];
        return nLines.some(l => String(l.unit_id || parent.unit_id || '') === targetUnitId);
      })
      .forEach(parent => {
        const nLines = (linesByNote.get(String(parent.id)) || []).filter(
          l => String(l.unit_id || parent.unit_id || '') === targetUnitId
        );

        const byConceptKey: Record<string, number> = {};

        nLines.forEach(ln => {
          const cid = String(ln.conceptId ?? ln.concept_id ?? '');
          if (cid && activeConceptById.size > 0 && !activeConceptById.has(cid)) return;
          if (selectedConceptId !== 'ALL' && cid !== selectedConceptId) return;
          const cObj = cid ? activeConceptById.get(cid) || conceptMap.get(cid) : undefined;
          const label = cObj?.name || 'Ajuste Nota';
          const key = cid ? `cid_${cid}` : `lbl_${label.toUpperCase()}`;
          const delta = noteLineSignedDelta(parent, ln);
          addMovementToConcept(byConceptKey, key, label, cid || undefined, delta);
        });

        const totalDoc = roundMoney(
          Object.values(byConceptKey).reduce((s, v) => s + v, 0)
        );

        if (selectedConceptId === 'ALL' || Math.abs(totalDoc) > 0) {
          const typeLabel =
            parent.note_type === 'NT'
              ? 'Traslado de cartera (NT)'
              : parent.note_type === 'NC'
              ? 'Nota crédito (NC)'
              : parent.note_type === 'ND'
              ? 'Nota débito (ND)'
              : parent.note_type || 'Nota';
          rawEvents.push({
            date: String(parent.accounting_date || parent.application_date || ''),
            doc: String(parent.note_number || parent.note_type),
            detail: `${typeLabel}${parent.description ? ` · ${parent.description}` : ''}`,
            totalDoc,
            discountApplied: 0,
            byConceptKey,
          });
        }
      });

    rawEvents.sort((a, b) => a.date.localeCompare(b.date));

    const columns = Array.from(candidateCols.values()).filter(col =>
      rawEvents.some(ev => Math.abs(roundMoney(ev.byConceptKey[col.key] || 0)) > 0.005)
    );

    let runningSaldo = 0;
    let finalTotalDoc = 0;
    const finalConceptTotals: Record<string, number> = {};
    columns.forEach(col => {
      finalConceptTotals[col.key] = 0;
    });

    const rows = rawEvents.map(ev => {
      const disc = roundMoney(ev.discountApplied || 0);
      const netDocImpact = roundMoney(ev.totalDoc + disc);
      runningSaldo = roundMoney(runningSaldo + netDocImpact);
      finalTotalDoc = roundMoney(finalTotalDoc + netDocImpact);
      const conceptValues: Record<string, number> = {};
      columns.forEach(col => {
        const v = roundMoney(ev.byConceptKey[col.key] || 0);
        conceptValues[col.key] = v;
        finalConceptTotals[col.key] = roundMoney((finalConceptTotals[col.key] || 0) + v);
      });
      return {
        date: ev.date,
        doc: ev.doc,
        detail: ev.detail,
        totalDoc: ev.totalDoc,
        discountApplied: disc,
        conceptValues,
        balance: runningSaldo,
        code: unitLabelText(uObj),
        ownerName: tpObj?.name || uObj?.owner_name || '—',
        docId: tpObj?.document_number || uObj?.owner_document || '—',
      };
    });

    return {
      columns,
      rows,
      finalTotalDoc,
      finalConceptTotals,
      finalBalance: runningSaldo,
    };
  }, [
    selectedUnitId,
    filteredUnits,
    unitMap,
    tpMap,
    pmMap,
    conceptMap,
    activeConceptById,
    getInvoiceBaseConceptAmounts,
    invoices,
    receipts,
    allocsByReceiptId,
    notes,
    noteLines,
    isStatusAllowed,
    isDateAllowed,
    selectedConceptId,
  ]);

  // KPIs sincronizados con los filtros activos
  const kpis = useMemo(() => {
    const isSingleUnit = Boolean(selectedUnitId) || filteredUnits.length === 1;

    let totalPortfolio = 0;
    let overduePortfolio = 0;

    if (isSingleUnit && detailedStatementData.rows.length > 0) {
      totalPortfolio = roundMoney(Math.max(0, detailedStatementData.finalBalance));
      overduePortfolio = roundMoney(Math.max(0, detailedStatementData.finalBalance));
    } else {
      allDetailedItems.forEach(it => {
        const bal = roundMoney(Number(it.balance || 0));
        totalPortfolio = roundMoney(totalPortfolio + bal);
        if (bal > 0 && daysPastDue(it.dueDate, effectiveCutoff) > 0) {
          overduePortfolio = roundMoney(overduePortfolio + bal);
        }
      });
    }

    let advanceTotal = 0;
    receipts.forEach(r => {
      if (!isStatusAllowed(r.status)) return;
      if (!allowedUnitIds.has(String(r.unit_id || ''))) return;
      if (!isDateAllowed(r.payment_date || r.accounting_date)) return;
      advanceTotal = roundMoney(advanceTotal + Number(r.advance_amount || 0));
    });

    noteLines.forEach(ln => {
      const parentNote = noteByIdMap.get(String(ln.note_id));
      if (!parentNote || !isStatusAllowed(parentNote.status)) return;
      const uid = String(ln.unit_id || parentNote.unit_id || '');
      if (!allowedUnitIds.has(uid)) return;
      if (!isDateAllowed(parentNote.accounting_date || parentNote.application_date)) return;
      const cid = String(ln.conceptId ?? ln.concept_id ?? '');
      if (selectedConceptId !== 'ALL' && cid !== selectedConceptId) {
        return;
      }
      advanceTotal = roundMoney(advanceTotal + Number(ln.advance_amount || 0));
    });

    const collectedInRange = roundMoney(
      receipts.reduce((sum, r) => {
        if (!isStatusAllowed(r.status)) return sum;
        if (!allowedUnitIds.has(String(r.unit_id || ''))) return sum;
        if (!isDateAllowed(r.payment_date || r.accounting_date)) return sum;
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
    selectedUnitId,
    filteredUnits,
    detailedStatementData,
    allDetailedItems,
    receipts,
    noteByIdMap,
    noteLines,
    allowedUnitIds,
    isStatusAllowed,
    isDateAllowed,
    effectiveCutoff,
    selectedConceptId,
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
      const past = daysPastDue(it.dueDate, effectiveCutoff);
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
  }, [allDetailedItems, conceptMap, effectiveCutoff]);

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
      const past = daysPastDue(it.dueDate, effectiveCutoff);

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
  }, [allDetailedItems, unitMap, effectiveCutoff]);

  // 5. Relación de Recibos de Caja
  const receiptRows = useMemo(() => {
    return receipts
      .filter(r => {
        if (!allowedUnitIds.has(String(r.unit_id || ''))) return false;
        if (!isDateAllowed(r.payment_date || r.accounting_date)) return false;
        if (!isStatusAllowed(r.status)) return false;
        return true;
      })
      .map(r => {
        const uObj = unitMap.get(String(r.unit_id || ''));
        const rAllocs = allocsByReceiptId.get(String(r.id)) || [];
        const allocSum = roundMoney(
          rAllocs.reduce(
            (s, a) => s + Number(a.capital_applied || 0) + Number(a.interest_applied || 0),
            0
          )
        );
        const appliedAmt =
          r.applied_amount != null ? roundMoney(Number(r.applied_amount)) : allocSum;
        return {
          id: String(r.id),
          receiptNumber: String(r.receipt_number || 'RC'),
          paymentDate: String(r.payment_date || '—'),
          accountingDate: String(r.accounting_date || '—'),
          unitLabel: unitLabelText(uObj),
          ownerName: uObj?.owner_name || '—',
          paymentMethod: r.payment_method_id
            ? pmMap.get(String(r.payment_method_id)) || '—'
            : '—',
          totalAmount: roundMoney(Number(r.total_amount || 0)),
          appliedAmount: appliedAmt,
          advanceAmount: roundMoney(Number(r.advance_amount || 0)),
          status: String(r.status || 'contabilizado'),
          notes: String(r.notes || ''),
        };
      });
  }, [receipts, allocsByReceiptId, allowedUnitIds, isDateAllowed, isStatusAllowed, unitMap, pmMap]);

  // 6. Recaudo por Fecha o Medio de Pago
  const collectionSummaryRows = useMemo(() => {
    const map = new Map<
      string,
      {
        date: string;
        method: string;
        count: number;
        totalAmount: number;
        appliedAmount: number;
        advanceAmount: number;
      }
    >();

    receiptRows.forEach(r => {
      const key = `${r.paymentDate}__${r.paymentMethod}`;
      if (!map.has(key)) {
        map.set(key, {
          date: r.paymentDate,
          method: r.paymentMethod,
          count: 0,
          totalAmount: 0,
          appliedAmount: 0,
          advanceAmount: 0,
        });
      }
      const row = map.get(key)!;
      row.count += 1;
      row.totalAmount = roundMoney(row.totalAmount + r.totalAmount);
      row.appliedAmount = roundMoney(row.appliedAmount + r.appliedAmount);
      row.advanceAmount = roundMoney(row.advanceAmount + r.advanceAmount);
    });

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [receiptRows]);

  // 7. Saldos a Favor / Anticipos
  const advancesRows = useMemo(() => {
    const map = new Map<
      string,
      {
        unitId: string;
        unitLabel: string;
        ownerName: string;
        fromReceipts: number;
        fromNotes: number;
        totalAdvance: number;
      }
    >();

    const ensureUnit = (uid: string) => {
      if (!map.has(uid)) {
        const uObj = unitMap.get(uid);
        map.set(uid, {
          unitId: uid,
          unitLabel: unitLabelText(uObj),
          ownerName: uObj?.owner_name || '—',
          fromReceipts: 0,
          fromNotes: 0,
          totalAdvance: 0,
        });
      }
      return map.get(uid)!;
    };

    receipts.forEach(r => {
      if (!isStatusAllowed(r.status)) return;
      const uid = String(r.unit_id || '');
      if (!allowedUnitIds.has(uid)) return;
      if (!isDateAllowed(r.accounting_date || r.payment_date)) return;
      const adv = roundMoney(Number(r.advance_amount || 0));
      if (adv <= 0) return;
      const row = ensureUnit(uid);
      row.fromReceipts = roundMoney(row.fromReceipts + adv);
      row.totalAdvance = roundMoney(row.totalAdvance + adv);
    });

    noteLines.forEach(ln => {
      const parent = noteByIdMap.get(String(ln.note_id));
      if (!parent || !isStatusAllowed(parent.status)) return;
      const uid = String(ln.unit_id || parent.unit_id || '');
      if (!allowedUnitIds.has(uid)) return;
      if (!isDateAllowed(parent.accounting_date || parent.application_date)) return;
      const cid = String(ln.conceptId ?? ln.concept_id ?? '');
      if (selectedConceptId !== 'ALL' && cid !== selectedConceptId) {
        return;
      }
      const adv = roundMoney(Number(ln.advance_amount || 0));
      if (adv <= 0) return;
      const row = ensureUnit(uid);
      row.fromNotes = roundMoney(row.fromNotes + adv);
      row.totalAdvance = roundMoney(row.totalAdvance + adv);
    });

    return Array.from(map.values()).sort((a, b) => b.totalAdvance - a.totalAdvance);
  }, [
    receipts,
    noteLines,
    noteByIdMap,
    allowedUnitIds,
    isStatusAllowed,
    isDateAllowed,
    selectedConceptId,
    unitMap,
  ]);

  // 8. Paz y Salvo de Cartera
  const pazYSalvoRows = useMemo(() => {
    const balanceByUnit = new Map<string, { current: number; overdue: number; total: number }>();

    allDetailedItems.forEach(it => {
      const bal = roundMoney(Number(it.balance || 0));
      const uid = String(it.unitId);
      if (!balanceByUnit.has(uid)) {
        balanceByUnit.set(uid, { current: 0, overdue: 0, total: 0 });
      }
      const b = balanceByUnit.get(uid)!;
      if (bal > 0) {
        if (daysPastDue(it.dueDate, effectiveCutoff) > 0) {
          b.overdue = roundMoney(b.overdue + bal);
        } else {
          b.current = roundMoney(b.current + bal);
        }
        b.total = roundMoney(b.total + bal);
      }
    });

    return filteredUnits.map(u => {
      const b = balanceByUnit.get(String(u.id)) || { current: 0, overdue: 0, total: 0 };
      const isClear = b.total <= 0.01;
      return {
        unitId: String(u.id),
        unitLabel: unitLabelText(u),
        ownerName: u.owner_name || '—',
        ownerDoc: u.owner_document || '—',
        currentBalance: b.current,
        overdueBalance: b.overdue,
        totalBalance: b.total,
        statusLabel: isClear ? 'PAZ Y SALVO' : 'CON SALDO PENDIENTE',
        isClear,
      };
    });
  }, [filteredUnits, allDetailedItems, effectiveCutoff]);

  // 9. Relación de Notas NC / ND / NT
  const treasuryNotesRows = useMemo(() => {
    return notes
      .filter(n => {
        const nLines = noteLines.filter(l => String(l.note_id) === String(n.id));
        const matchesUnit =
          allowedUnitIds.size === 0 ||
          (n.unit_id && allowedUnitIds.has(String(n.unit_id))) ||
          nLines.some(l => l.unit_id && allowedUnitIds.has(String(l.unit_id)));
        if (!matchesUnit) return false;
        if (!isDateAllowed(n.accounting_date || n.application_date)) return false;
        if (!isStatusAllowed(n.status)) return false;
        return true;
      })
      .map(n => {
        const uObj = unitMap.get(String(n.unit_id || ''));
        return {
          id: String(n.id),
          noteNumber: String(n.note_number || '—'),
          noteType: String(n.note_type || '—'),
          date: String(n.accounting_date || n.application_date || '—'),
          period: String(n.period || '—'),
          unitLabel: unitLabelText(uObj),
          ownerName: uObj?.owner_name || '—',
          totalAmount: roundMoney(Number(n.total_amount || 0)),
          status: String(n.status || 'contabilizado'),
          description: String(n.description || ''),
        };
      });
  }, [notes, noteLines, allowedUnitIds, isDateAllowed, isStatusAllowed, unitMap]);

  // 10. Cartera Morosa
  const delinquencyRows = useMemo(() => {
    const map = new Map<
      string,
      {
        unitId: string;
        unitLabel: string;
        ownerName: string;
        ownerPhone: string;
        overdueBalance: number;
        maxDaysPastDue: number;
      }
    >();

    allDetailedItems.forEach(it => {
      const bal = roundMoney(Number(it.balance || 0));
      if (bal <= 0) return;
      const past = daysPastDue(it.dueDate, effectiveCutoff);
      if (past <= 0) return;

      const uid = String(it.unitId);
      const uObj = unitMap.get(uid);
      if (!map.has(uid)) {
        map.set(uid, {
          unitId: uid,
          unitLabel: unitLabelText(uObj),
          ownerName: uObj?.owner_name || '—',
          ownerPhone: uObj?.owner_phone || '—',
          overdueBalance: 0,
          maxDaysPastDue: 0,
        });
      }
      const row = map.get(uid)!;
      row.overdueBalance = roundMoney(row.overdueBalance + bal);
      if (past > row.maxDaysPastDue) row.maxDaysPastDue = past;
    });

    return Array.from(map.values()).sort((a, b) => b.overdueBalance - a.overdueBalance);
  }, [allDetailedItems, unitMap, effectiveCutoff]);

  function handleExportCsv() {
    const stamp = dateTo || cutoffDate || today;
    if (activeReport === 'statement_summary') {
      const headers = [
        'PERIODO',
        'ADMON',
        'INTERESES',
        'RETROACTIVO',
        'CUOTA EXTRA',
        'OTROS',
        'TOTAL COBRO MES',
        'AJUSTES',
        'PAGOS',
        ...(hasSummaryDiscount ? ['DESCUENTO'] : []),
        'SALDO',
        'FECHA PAGO',
      ];
      const rows = summaryStatementRows.map(r => [
        r.period,
        r.admon,
        r.intereses,
        r.retroactivo,
        r.cuotaExtra,
        r.otros,
        r.totalCobro,
        r.ajustes,
        r.pagos,
        ...(hasSummaryDiscount ? [r.descuento] : []),
        r.saldo,
        r.lastPaymentDate,
      ]);
      downloadCsv(`estado-cuenta-resumido-${stamp}.csv`, headers, rows);
    } else if (activeReport === 'statement_detailed') {
      const csvRows: (string | number)[][] = detailedStatementData.rows.map(r => {
        const docText =
          Math.abs(roundMoney(r.discountApplied || 0)) >= 0.005
            ? `${r.totalDoc} (Descuento aplicado: ${r.discountApplied})`
            : r.totalDoc;
        return [
          r.date,
          r.doc,
          r.detail,
          docText,
          ...detailedStatementData.columns.map(c => r.conceptValues[c.key] || 0),
          r.balance,
        ];
      });
      if (detailedStatementData.rows.length > 0) {
        csvRows.push([
          '',
          'SALDO FINAL',
          'Saldo final por concepto',
          detailedStatementData.finalTotalDoc,
          ...detailedStatementData.columns.map(
            c => detailedStatementData.finalConceptTotals[c.key] || 0
          ),
          detailedStatementData.finalBalance,
        ]);
      }
      downloadCsv(
        `estado-cuenta-detallado-${stamp}.csv`,
        [
          'FECHA',
          'DOCUMENTO',
          'DETALLE',
          'TOTAL DOCUMENTO',
          ...detailedStatementData.columns.map(c => c.label.toUpperCase()),
          'SALDO',
        ],
        csvRows
      );
    } else if (activeReport === 'by_concept') {
      downloadCsv(
        `cartera-por-conceptos-${stamp}.csv`,
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
    } else if (activeReport === 'by_aging') {
      downloadCsv(
        `cartera-por-edades-${stamp}.csv`,
        ['INMUEBLE', 'PROPIETARIO', 'POR VENCER', '1-30 DIAS', '31-60 DIAS', '61-90 DIAS', '+90 DIAS', 'TOTAL'],
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
    } else if (activeReport === 'receipts_list') {
      downloadCsv(
        `relacion-recibos-${stamp}.csv`,
        ['RECIBO', 'FECHA PAGO', 'FECHA CONTABLE', 'INMUEBLE', 'PROPIETARIO', 'MEDIO PAGO', 'TOTAL', 'APLICADO', 'ANTICIPO', 'ESTADO'],
        receiptRows.map(r => [
          r.receiptNumber,
          r.paymentDate,
          r.accountingDate,
          r.unitLabel,
          r.ownerName,
          r.paymentMethod,
          r.totalAmount,
          r.appliedAmount,
          r.advanceAmount,
          r.status,
        ])
      );
    } else if (activeReport === 'collection_summary') {
      downloadCsv(
        `recaudo-fecha-medio-${stamp}.csv`,
        ['FECHA', 'MEDIO PAGO', 'RECIBOS', 'TOTAL RECAUDO', 'APLICADO', 'ANTICIPO'],
        collectionSummaryRows.map(r => [
          r.date,
          r.method,
          r.count,
          r.totalAmount,
          r.appliedAmount,
          r.advanceAmount,
        ])
      );
    } else if (activeReport === 'advances') {
      downloadCsv(
        `saldos-a-favor-${stamp}.csv`,
        ['INMUEBLE', 'PROPIETARIO', 'ANTICIPO RECIBOS', 'ANTICIPO NOTAS', 'TOTAL SALDO A FAVOR'],
        advancesRows.map(r => [
          r.unitLabel,
          r.ownerName,
          r.fromReceipts,
          r.fromNotes,
          r.totalAdvance,
        ])
      );
    } else if (activeReport === 'paz_y_salvo') {
      downloadCsv(
        `paz-y-salvo-${stamp}.csv`,
        ['INMUEBLE', 'PROPIETARIO', 'DOCUMENTO', 'SALDO VENCIDO', 'SALDO TOTAL', 'ESTADO'],
        pazYSalvoRows.map(r => [
          r.unitLabel,
          r.ownerName,
          r.ownerDoc,
          r.overdueBalance,
          r.totalBalance,
          r.statusLabel,
        ])
      );
    } else if (activeReport === 'treasury_notes') {
      downloadCsv(
        `notas-tesoreria-${stamp}.csv`,
        ['NUMERO', 'TIPO', 'FECHA', 'PERIODO', 'INMUEBLE', 'VALOR', 'ESTADO', 'DESCRIPCION'],
        treasuryNotesRows.map(r => [
          r.noteNumber,
          r.noteType,
          r.date,
          r.period,
          r.unitLabel,
          r.totalAmount,
          r.status,
          r.description,
        ])
      );
    } else {
      downloadCsv(
        `cartera-morosa-${stamp}.csv`,
        ['INMUEBLE', 'PROPIETARIO', 'TELEFONO', 'DIAS MORA MAX', 'SALDO VENCIDO'],
        delinquencyRows.map(r => [
          r.unitLabel,
          r.ownerName,
          r.ownerPhone,
          r.maxDaysPastDue,
          r.overdueBalance,
        ])
      );
    }
  }

  function handlePrintReport() {
    const activeTabObj = REPORT_TABS.find(t => t.key === activeReport);
    const reportTitle = activeTabObj ? activeTabObj.label.toUpperCase() : 'REPORTE DE CARTERA';
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
        'Otros',
        'Total Cobro',
        'Ajustes',
        'Pagos',
        ...(hasSummaryDiscount ? ['Descuento'] : []),
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
            <td class="num">${escapeHtml(formatCOP(r.otros))}</td>
            <td class="num">${escapeHtml(formatCOP(r.totalCobro))}</td>
            <td class="num ${r.ajustes < 0 ? 'neg' : ''}">${escapeHtml(formatCOP(r.ajustes))}</td>
            <td class="num ${r.pagos < 0 ? 'neg' : ''}">${escapeHtml(formatCOP(r.pagos))}</td>
            ${
              hasSummaryDiscount
                ? `<td class="num ${r.descuento < 0 ? 'neg' : ''}">${escapeHtml(formatCOP(r.descuento))}</td>`
                : ''
            }
            <td class="num ${r.saldo < 0 ? 'neg' : ''}"><strong>${escapeHtml(formatCOP(r.saldo))}</strong></td>
            <td>${escapeHtml(r.lastPaymentDate || '—')}</td>
          </tr>`
        )
        .join('');
    } else if (activeReport === 'statement_detailed') {
      tableHeaders = [
        'Fecha',
        'Documento',
        'Detalle',
        'Total Documento',
        ...detailedStatementData.columns.map(c => c.label),
        'Saldo',
      ];
      const bodyHtml = detailedStatementData.rows
        .map(r => {
          const conceptCells = detailedStatementData.columns
            .map(c => {
              const v = roundMoney(r.conceptValues[c.key] || 0);
              return `<td class="num ${v < 0 ? 'neg' : ''}">${escapeHtml(formatCOP(v))}</td>`;
            })
            .join('');
          const hasDisc = Math.abs(roundMoney(r.discountApplied || 0)) >= 0.005;
          const totalDocHtml = hasDisc
            ? `<div>${escapeHtml(formatCOP(r.totalDoc))}</div><div class="sub-disc">${escapeHtml(formatCOP(r.discountApplied))}</div>`
            : escapeHtml(formatCOP(r.totalDoc));
          return `<tr>
            <td>${escapeHtml(r.date || '—')}</td>
            <td>${escapeHtml(r.doc)}</td>
            <td>${escapeHtml(r.detail)}</td>
            <td class="num ${r.totalDoc < 0 ? 'neg' : ''}">${totalDocHtml}</td>
            ${conceptCells}
            <td class="num ${r.balance < 0 ? 'neg' : ''}"><strong>${escapeHtml(formatCOP(r.balance))}</strong></td>
          </tr>`;
        })
        .join('');

      const finalRowHtml =
        detailedStatementData.rows.length > 0
          ? `<tr class="final-row">
              <td colspan="3"><strong>SALDO FINAL POR CONCEPTO</strong></td>
              <td class="num ${detailedStatementData.finalTotalDoc < 0 ? 'neg' : ''}"><strong>${escapeHtml(formatCOP(detailedStatementData.finalTotalDoc))}</strong></td>
              ${detailedStatementData.columns
                .map(c => {
                  const v = roundMoney(detailedStatementData.finalConceptTotals[c.key] || 0);
                  return `<td class="num ${v < 0 ? 'neg' : ''}"><strong>${escapeHtml(formatCOP(v))}</strong></td>`;
                })
                .join('')}
              <td class="num ${detailedStatementData.finalBalance < 0 ? 'neg' : ''}"><strong>${escapeHtml(formatCOP(detailedStatementData.finalBalance))}</strong></td>
            </tr>`
          : '';

      tableRowsHtml = bodyHtml + finalRowHtml;
    } else if (activeReport === 'by_concept') {
      tableHeaders = ['Código', 'Concepto', 'Inmuebles', 'Por Vencer', 'Vencida', 'Total'];
      tableRowsHtml = byConceptRows
        .map(
          r => `<tr><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.name)}</td><td class="num">${r.unitsCount}</td><td class="num">${escapeHtml(formatCOP(r.currentAmt))}</td><td class="num">${escapeHtml(formatCOP(r.overdueAmt))}</td><td class="num"><strong>${escapeHtml(formatCOP(r.totalAmt))}</strong></td></tr>`
        )
        .join('');
    } else if (activeReport === 'by_aging') {
      tableHeaders = ['Inmueble', 'Propietario', 'Por Vencer', '1-30 Días', '31-60 Días', '61-90 Días', '+90 Días', 'Total'];
      tableRowsHtml = byAgingRows
        .map(
          r => `<tr><td>${escapeHtml(r.unitLabel)}</td><td>${escapeHtml(r.ownerName)}</td><td class="num">${escapeHtml(formatCOP(r.currentAmt))}</td><td class="num">${escapeHtml(formatCOP(r.d1_30))}</td><td class="num">${escapeHtml(formatCOP(r.d31_60))}</td><td class="num">${escapeHtml(formatCOP(r.d61_90))}</td><td class="num">${escapeHtml(formatCOP(r.d90_plus))}</td><td class="num"><strong>${escapeHtml(formatCOP(r.totalAmt))}</strong></td></tr>`
        )
        .join('');
    } else if (activeReport === 'receipts_list') {
      tableHeaders = ['Recibo', 'Fecha Pago', 'Inmueble', 'Medio', 'Total', 'Aplicado', 'Anticipo', 'Estado'];
      tableRowsHtml = receiptRows
        .map(
          r => `<tr><td>${escapeHtml(r.receiptNumber)}</td><td>${escapeHtml(r.paymentDate)}</td><td>${escapeHtml(r.unitLabel)}</td><td>${escapeHtml(r.paymentMethod)}</td><td class="num">${escapeHtml(formatCOP(r.totalAmount))}</td><td class="num">${escapeHtml(formatCOP(r.appliedAmount))}</td><td class="num">${escapeHtml(formatCOP(r.advanceAmount))}</td><td>${escapeHtml(r.status)}</td></tr>`
        )
        .join('');
    } else if (activeReport === 'collection_summary') {
      tableHeaders = ['Fecha', 'Medio de Pago', 'Recibos', 'Total Recaudo', 'Aplicado', 'Anticipo'];
      tableRowsHtml = collectionSummaryRows
        .map(
          r => `<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.method)}</td><td class="num">${r.count}</td><td class="num"><strong>${escapeHtml(formatCOP(r.totalAmount))}</strong></td><td class="num">${escapeHtml(formatCOP(r.appliedAmount))}</td><td class="num">${escapeHtml(formatCOP(r.advanceAmount))}</td></tr>`
        )
        .join('');
    } else if (activeReport === 'advances') {
      tableHeaders = ['Inmueble', 'Propietario', 'Anticipo Recibos', 'Anticipo Notas', 'Total Saldo a Favor'];
      tableRowsHtml = advancesRows
        .map(
          r => `<tr><td>${escapeHtml(r.unitLabel)}</td><td>${escapeHtml(r.ownerName)}</td><td class="num">${escapeHtml(formatCOP(r.fromReceipts))}</td><td class="num">${escapeHtml(formatCOP(r.fromNotes))}</td><td class="num"><strong>${escapeHtml(formatCOP(r.totalAdvance))}</strong></td></tr>`
        )
        .join('');
    } else if (activeReport === 'paz_y_salvo') {
      tableHeaders = ['Inmueble', 'Propietario', 'Documento', 'Saldo Vencido', 'Saldo Total', 'Estado'];
      tableRowsHtml = pazYSalvoRows
        .map(
          r => `<tr><td>${escapeHtml(r.unitLabel)}</td><td>${escapeHtml(r.ownerName)}</td><td>${escapeHtml(r.ownerDoc)}</td><td class="num">${escapeHtml(formatCOP(r.overdueBalance))}</td><td class="num">${escapeHtml(formatCOP(r.totalBalance))}</td><td><strong>${escapeHtml(r.statusLabel)}</strong></td></tr>`
        )
        .join('');
    } else if (activeReport === 'treasury_notes') {
      tableHeaders = ['Número', 'Tipo', 'Fecha', 'Período', 'Inmueble', 'Valor', 'Estado', 'Detalle'];
      tableRowsHtml = treasuryNotesRows
        .map(
          r => `<tr><td>${escapeHtml(r.noteNumber)}</td><td>${escapeHtml(r.noteType)}</td><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.period)}</td><td>${escapeHtml(r.unitLabel)}</td><td class="num"><strong>${escapeHtml(formatCOP(r.totalAmount))}</strong></td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.description)}</td></tr>`
        )
        .join('');
    } else {
      tableHeaders = ['Inmueble', 'Propietario', 'Teléfono', 'Días Mora', 'Saldo Vencido'];
      tableRowsHtml = delinquencyRows
        .map(
          r => `<tr><td>${escapeHtml(r.unitLabel)}</td><td>${escapeHtml(r.ownerName)}</td><td>${escapeHtml(r.ownerPhone)}</td><td class="num">${r.maxDaysPastDue}</td><td class="num"><strong>${escapeHtml(formatCOP(r.overdueBalance))}</strong></td></tr>`
        )
        .join('');
    }

    const rangeSub =
      dateFrom || dateTo
        ? `Rango: ${escapeHtml(dateFrom || 'Inicio')} a ${escapeHtml(dateTo || 'Fin')}`
        : `Fecha de corte: ${escapeHtml(cutoffDate || 'Sin corte')}`;

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>${escapeHtml(reportTitle)}</title><style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 24px; color: #111827; }
      h1 { font-size: 16px; margin: 0; }
      .sub { font-size: 12px; color: #4b5563; margin-top: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 11px; }
      th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }
      th { background: #f3f4f6; font-weight: 700; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      .neg { color: #b91c1c; }
      .sub-disc { color: #b91c1c; font-size: 10px; }
      .final-row td { background: #f9fafb; border-top: 2px solid #374151; }
    </style></head><body>
      <h1>${escapeHtml(activeOrg?.name || 'Copropiedad')} — ${escapeHtml(reportTitle)}</h1>
      <div class="sub">${rangeSub}</div>
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
      <Card>
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                MOD-07 · Reportes de Cartera
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Consultas, estados de cuenta, recaudos, paz y salvo y cartera morosa.
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
            {REPORT_TABS.map(tab => {
              const IconComp = tab.icon;
              const isActive = activeReport === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveReport(tab.key)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <IconComp className="w-3.5 h-3.5" /> {tab.label}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end pt-1">
            <Input
              label="Fecha de corte"
              type="date"
              value={cutoffDate}
              onChange={e => setCutoffDate(e.target.value)}
            />
            <Input
              label="Desde"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
            />
            <Input
              label="Hasta"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
            />
            <Select
              label="Agrupación / Torre"
              value={selectedTower}
              onChange={e => setSelectedTower(e.target.value)}
            >
              <option value="ALL">Todas</option>
              {towers.map(t => (
                <option key={t} value={t}>
                  Torre {t}
                </option>
              ))}
            </Select>
            <Select
              label="Inmueble"
              value={selectedUnitId}
              onChange={e => setSelectedUnitId(e.target.value)}
            >
              <option value="">
                {requiresSingleUnit ? '— Seleccione inmueble —' : 'Todos'}
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
              <option value="ALL">Todos</option>
              {concepts.map(c => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
            <Select
              label="Estado Doc."
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="ALL">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="contabilizado">Contabilizado</option>
              <option value="pagada">Pagada</option>
              <option value="anulado">Anulado</option>
            </Select>
          </div>
        </div>
      </Card>

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
                  <span className="text-gray-500">PROPIETARIO: </span>
                  <strong className="text-gray-900">{activeUnitObj?.owner_name || '—'}</strong>
                </div>
                <div>
                  <span className="text-gray-500">CORTE / RANGO: </span>
                  <strong className="text-gray-900">
                    {dateFrom || dateTo
                      ? `${dateFrom || 'Inicio'} → ${dateTo || 'Fin'}`
                      : cutoffDate || 'Sin corte'}
                  </strong>
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
                      <th className="px-3 py-2.5 text-right">Otros</th>
                      <th className="px-3 py-2.5 text-right">Total Cobro Mes</th>
                      <th className="px-3 py-2.5 text-right">Ajustes</th>
                      <th className="px-3 py-2.5 text-right">Pagos</th>
                      {hasSummaryDiscount && (
                        <th className="px-3 py-2.5 text-right">Descuento</th>
                      )}
                      <th className="px-3 py-2.5 text-right">Saldo</th>
                      <th className="px-3 py-2.5">Fecha Pago</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {summaryStatementRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={hasSummaryDiscount ? 12 : 11}
                          className="px-4 py-8 text-center text-gray-500"
                        >
                          No hay movimientos registrados para este inmueble con los filtros seleccionados.
                        </td>
                      </tr>
                    ) : (
                      summaryStatementRows.map(r => (
                        <tr key={r.period} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono font-medium">{r.period}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCOP(r.admon)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCOP(r.intereses)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCOP(r.retroactivo)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCOP(r.cuotaExtra)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCOP(r.otros)}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">
                            {formatCOP(r.totalCobro)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              r.ajustes < 0 ? 'text-red-600' : 'text-gray-900'
                            }`}
                          >
                            {formatCOP(r.ajustes)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              r.pagos < 0 ? 'text-red-600' : 'text-gray-900'
                            }`}
                          >
                            {formatCOP(r.pagos)}
                          </td>
                          {hasSummaryDiscount && (
                            <td
                              className={`px-3 py-2 text-right font-mono ${
                                r.descuento < 0 ? 'text-red-600' : 'text-gray-900'
                              }`}
                            >
                              {formatCOP(r.descuento)}
                            </td>
                          )}
                          <td
                            className={`px-3 py-2 text-right font-mono font-bold ${
                              r.saldo < 0 ? 'text-red-600' : 'text-gray-900'
                            }`}
                          >
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
                      <th className="px-3 py-2.5 text-right">Total Documento</th>
                      {detailedStatementData.columns.map(col => (
                        <th key={col.key} className="px-3 py-2.5 text-right">
                          {col.label}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {detailedStatementData.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5 + detailedStatementData.columns.length}
                          className="px-4 py-8 text-center text-gray-500"
                        >
                          Sin movimientos detallados con los filtros seleccionados.
                        </td>
                      </tr>
                    ) : (
                      detailedStatementData.rows.map((r, idx) => {
                        const hasDisc = Math.abs(roundMoney(r.discountApplied || 0)) >= 0.005;
                        return (
                          <tr key={`${r.doc}-${idx}`} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono">{r.date || '—'}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-blue-700">
                              {r.doc}
                            </td>
                            <td className="px-3 py-2">{r.detail}</td>
                            <td
                              className={`px-3 py-2 text-right font-mono font-semibold ${
                                r.totalDoc < 0 ? 'text-red-600' : 'text-gray-900'
                              }`}
                            >
                              <div>{formatCOP(r.totalDoc)}</div>
                              {hasDisc && (
                                <div className="text-[11px] font-medium text-red-600">
                                  {formatCOP(r.discountApplied)}
                                </div>
                              )}
                            </td>
                            {detailedStatementData.columns.map(col => {
                              const v = roundMoney(r.conceptValues[col.key] || 0);
                              return (
                                <td
                                  key={col.key}
                                  className={`px-3 py-2 text-right font-mono ${
                                    v < 0 ? 'text-red-600' : 'text-gray-900'
                                  }`}
                                >
                                  {formatCOP(v)}
                                </td>
                              );
                            })}
                            <td
                              className={`px-3 py-2 text-right font-mono font-bold ${
                                r.balance < 0 ? 'text-red-600' : 'text-gray-900'
                              }`}
                            >
                              {formatCOP(r.balance)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {detailedStatementData.rows.length > 0 && (
                    <tfoot className="bg-gray-100 border-t-2 border-gray-300 text-xs">
                      <tr>
                        <td colSpan={3} className="px-3 py-2.5 font-bold text-gray-800 uppercase">
                          Saldo Final por Concepto
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono font-bold ${
                            detailedStatementData.finalTotalDoc < 0
                              ? 'text-red-600'
                              : 'text-gray-900'
                          }`}
                        >
                          {formatCOP(detailedStatementData.finalTotalDoc)}
                        </td>
                        {detailedStatementData.columns.map(col => {
                          const v = roundMoney(
                            detailedStatementData.finalConceptTotals[col.key] || 0
                          );
                          return (
                            <td
                              key={col.key}
                              className={`px-3 py-2.5 text-right font-mono font-bold ${
                                v < 0 ? 'text-red-600' : 'text-gray-900'
                              }`}
                            >
                              {formatCOP(v)}
                            </td>
                          );
                        })}
                        <td
                          className={`px-3 py-2.5 text-right font-mono font-bold ${
                            detailedStatementData.finalBalance < 0
                              ? 'text-red-600'
                              : 'text-gray-900'
                          }`}
                        >
                          {formatCOP(detailedStatementData.finalBalance)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
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
                        No hay saldos pendientes por concepto.
                      </td>
                    </tr>
                  ) : (
                    byConceptRows.map(r => (
                      <tr key={r.conceptId} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono">{r.code}</td>
                        <td className="px-3 py-2 font-medium">{r.name}</td>
                        <td className="px-3 py-2 text-right font-mono">{r.unitsCount}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCOP(r.currentAmt)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-red-700">
                          {formatCOP(r.overdueAmt)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold">
                          {formatCOP(r.totalAmt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : activeReport === 'by_aging' ? (
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
                    <th className="px-3 py-2.5 text-right">Total</th>
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
                        <td className="px-3 py-2 font-mono font-medium">{r.unitLabel}</td>
                        <td className="px-3 py-2">{r.ownerName}</td>
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
                        <td className="px-3 py-2 text-right font-mono font-bold">
                          {formatCOP(r.totalAmt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : activeReport === 'receipts_list' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Recibo</th>
                    <th className="px-3 py-2.5">Fecha Pago</th>
                    <th className="px-3 py-2.5">Inmueble</th>
                    <th className="px-3 py-2.5">Medio Pago</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-3 py-2.5 text-right">Aplicado</th>
                    <th className="px-3 py-2.5 text-right">Anticipo</th>
                    <th className="px-3 py-2.5">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {receiptRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                        No hay recibos de caja con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    receiptRows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-semibold text-blue-700">
                          {r.receiptNumber}
                        </td>
                        <td className="px-3 py-2 font-mono">{r.paymentDate}</td>
                        <td className="px-3 py-2 font-mono">{r.unitLabel}</td>
                        <td className="px-3 py-2">{r.paymentMethod}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold">
                          {formatCOP(r.totalAmount)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCOP(r.appliedAmount)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-blue-700">
                          {formatCOP(r.advanceAmount)}
                        </td>
                        <td className="px-3 py-2 uppercase text-[11px]">{r.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : activeReport === 'collection_summary' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Fecha Pago</th>
                    <th className="px-3 py-2.5">Medio de Pago</th>
                    <th className="px-3 py-2.5 text-right">Recibos</th>
                    <th className="px-3 py-2.5 text-right">Total Recaudo</th>
                    <th className="px-3 py-2.5 text-right">Aplicado</th>
                    <th className="px-3 py-2.5 text-right">Anticipo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {collectionSummaryRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                        No hay recaudos con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    collectionSummaryRows.map((r, idx) => (
                      <tr key={`${r.date}-${r.method}-${idx}`} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono">{r.date}</td>
                        <td className="px-3 py-2 font-medium">{r.method}</td>
                        <td className="px-3 py-2 text-right font-mono">{r.count}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">
                          {formatCOP(r.totalAmount)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCOP(r.appliedAmount)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-blue-700">
                          {formatCOP(r.advanceAmount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : activeReport === 'advances' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Inmueble</th>
                    <th className="px-3 py-2.5">Propietario</th>
                    <th className="px-3 py-2.5 text-right">Anticipo Recibos</th>
                    <th className="px-3 py-2.5 text-right">Anticipo Notas</th>
                    <th className="px-3 py-2.5 text-right">Total Saldo a Favor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {advancesRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                        No hay saldos a favor o anticipos con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    advancesRows.map(r => (
                      <tr key={r.unitId} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-medium">{r.unitLabel}</td>
                        <td className="px-3 py-2">{r.ownerName}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCOP(r.fromReceipts)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCOP(r.fromNotes)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-blue-700">
                          {formatCOP(r.totalAdvance)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : activeReport === 'paz_y_salvo' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Inmueble</th>
                    <th className="px-3 py-2.5">Propietario</th>
                    <th className="px-3 py-2.5">Documento</th>
                    <th className="px-3 py-2.5 text-right">Saldo Vencido</th>
                    <th className="px-3 py-2.5 text-right">Saldo Total</th>
                    <th className="px-3 py-2.5">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {pazYSalvoRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                        No hay inmuebles para evaluar.
                      </td>
                    </tr>
                  ) : (
                    pazYSalvoRows.map(r => (
                      <tr key={r.unitId} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-medium">{r.unitLabel}</td>
                        <td className="px-3 py-2">{r.ownerName}</td>
                        <td className="px-3 py-2 font-mono">{r.ownerDoc}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-700">
                          {formatCOP(r.overdueBalance)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold">
                          {formatCOP(r.totalBalance)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              r.isClear
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {r.statusLabel}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : activeReport === 'treasury_notes' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Número</th>
                    <th className="px-3 py-2.5">Tipo</th>
                    <th className="px-3 py-2.5">Fecha</th>
                    <th className="px-3 py-2.5">Período</th>
                    <th className="px-3 py-2.5">Inmueble</th>
                    <th className="px-3 py-2.5 text-right">Valor</th>
                    <th className="px-3 py-2.5">Estado</th>
                    <th className="px-3 py-2.5">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {treasuryNotesRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                        No hay notas de tesorería con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    treasuryNotesRows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-semibold text-blue-700">
                          {r.noteNumber}
                        </td>
                        <td className="px-3 py-2 font-mono font-bold">{r.noteType}</td>
                        <td className="px-3 py-2 font-mono">{r.date}</td>
                        <td className="px-3 py-2 font-mono">{r.period}</td>
                        <td className="px-3 py-2 font-mono">{r.unitLabel}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold">
                          {formatCOP(r.totalAmount)}
                        </td>
                        <td className="px-3 py-2 uppercase text-[11px]">{r.status}</td>
                        <td className="px-3 py-2">{r.description || '—'}</td>
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
                    <th className="px-3 py-2.5">Teléfono</th>
                    <th className="px-3 py-2.5 text-right">Días Mora Máx.</th>
                    <th className="px-3 py-2.5 text-right">Saldo Vencido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {delinquencyRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                        No hay inmuebles en mora con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    delinquencyRows.map(r => (
                      <tr key={r.unitId} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-medium">{r.unitLabel}</td>
                        <td className="px-3 py-2">{r.ownerName}</td>
                        <td className="px-3 py-2 font-mono">{r.ownerPhone}</td>
                        <td className="px-3 py-2 text-right font-mono text-amber-700">
                          {r.maxDaysPastDue}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-red-700">
                          {formatCOP(r.overdueBalance)}
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