import { useMemo, useState, useEffect } from 'react';
import {
  FileText, Eye, Download, Mail, Send, CheckCircle2, AlertTriangle,
  Loader2, Layers, FileStack, Trash2
} from 'lucide-react';
import { Unit, Due, PaymentAgreement, DiscountTier } from '@/lib/supabase';
import { Organization, supabase } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { formatCOP, formatShortDate } from '@/lib/format';

export interface ChargeLine {
  conceptId?: string;
  conceptName?: string;
  conceptCode?: string;
  name?: string;
  amount: number;
  isQuota?: boolean;
  isNovelty?: boolean;
}

export interface LiquidationRow {
  due?: Due;
  unit: Unit;
  daysLate?: number;
  interestRate?: number;
  priorBalance: number;
  currentCharges: number;
  chargeLines: ChargeLine[];
  interestAmount: number;
  discountAmount: number;
  customTierDiscounts?: Record<string, number>;
  netTotal: number;
  totalWithInterest?: number;
  baseAmount?: number;
  rowId: string;
  invoiceNumber?: string; // <-- Guardamos el consecutivo real aquí
  issueDate?: string;
  dueDate?: string;
}

interface Recipient {
  rowId: string;
  unitId: string;
  propertyName: string;
  ownerName: string;
  email: string;
  total: number;
}

interface SimResult {
  recipient: Recipient;
  status: 'enviado' | 'rebotado';
  detail: string;
}

type TemplateId = 'clasico' | 'moderno' | 'detallado';

const TEMPLATES: { id: TemplateId; name: string; description: string }[] = [
  { id: 'clasico', name: 'Clásico', description: 'Formato tradicional con encabezado corporativo y tabla comparativa de 4 columnas.' },
  { id: 'moderno', name: 'Moderno', description: 'Diseño limpio con secciones resaltadas y tipografía actualizada.' },
  { id: 'detallado', name: 'Detallado', description: 'Incluye desglose completo de conceptos, intereses, descuentos con fecha límite y acuerdo de pago (si aplica).' },
];

const templateLabels: Record<TemplateId, string> = {
  clasico: 'Clásico',
  moderno: 'Moderno',
  detallado: 'Detallado',
};

function round2(v: number): number { return Math.round(v * 100) / 100; }

export interface CalculatedDiscount {
  tierId: string;
  tierName: string;
  discountVal: number;
  validUntilDay: number;
  payWithDiscount: number;
}

function getCleanChargeLinesAmount(row: LiquidationRow): number {
  const linesTotal = (row.chargeLines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  if (linesTotal > 0) return round2(linesTotal);
  return round2(row.currentCharges || 0);
}

function computeAllTierDiscounts(row: LiquidationRow, discountTiers: DiscountTier[]): CalculatedDiscount[] {
  const cleanCharges = getCleanChargeLinesAmount(row);
  const grossTotal = round2(cleanCharges + (row.priorBalance || 0) + (row.interestAmount || 0));

  if (!discountTiers || discountTiers.length === 0) {
    const customVal = row.discountAmount || 0;
    return [{
      tierId: 'custom-tier',
      tierName: 'Escalón 1',
      discountVal: customVal,
      validUntilDay: 15,
      payWithDiscount: round2(grossTotal - customVal),
    }];
  }

  return discountTiers.map((tier, idx) => {
    let val = 0;
    const validDay = Number(tier.valid_until_day) || 1;

    if (row.customTierDiscounts && row.customTierDiscounts[tier.id] !== undefined) {
      val = row.customTierDiscounts[tier.id];
    } 
    else if (idx === 0 && row.discountAmount !== undefined && row.discountAmount > 0) {
      val = row.discountAmount;
    } 
    else {
      const discountValueNum = parseFloat(String(tier.discount_value)) || 0;
      if (tier.discount_type === 'porcentaje') {
        const baseConceptIds = tier.calculation_base_concept_ids;
        const base = baseConceptIds && baseConceptIds.length > 0
          ? round2((row.chargeLines || []).filter(l => l.conceptId && baseConceptIds.includes(l.conceptId)).reduce((s, l) => s + l.amount, 0))
          : cleanCharges;
        val = round2(base * discountValueNum / 100);
      } else {
        val = Math.min(discountValueNum, cleanCharges);
      }
    }

    return {
      tierId: tier.id,
      tierName: tier.name || `Escalón ${idx + 1}`,
      discountVal: val,
      validUntilDay: validDay,
      payWithDiscount: round2(grossTotal - val),
    };
  });
}

function buildPdfHtml(
  row: LiquidationRow,
  template: TemplateId,
  org: Organization | null,
  billingPeriod: string,
  agreements: PaymentAgreement[],
  invoiceNumber: string = 'CC-0061',
  discountTiers: DiscountTier[] = [],
  issueDateStr: string = '',
  dueDateStr: string = '',
): string {
  const orgName = org?.name || 'Organización';
  const orgAddress = org?.address || '';
  const orgPhone = org?.phone || '';
  const orgEmail = org?.email || '';

  const resolvedIssueDate = row.issueDate || issueDateStr;
  const resolvedDueDate = row.dueDate || dueDateStr;

  const issueDateFormatted = resolvedIssueDate ? formatShortDate(resolvedIssueDate) : formatShortDate(new Date().toISOString());
  const dueDateFormatted = resolvedDueDate ? formatShortDate(resolvedDueDate) : 'N/A';

  const unitAgreements = agreements.filter(a => a.unit_id === row.unit.id);
  const hasAgreement = unitAgreements.length > 0;
  const agreementNote = hasAgreement
    ? unitAgreements.map(a =>
      `Acuerdo activo: ${a.start_period} a ${a.end_period}, cuota ${formatCOP(a.monthly_amount)} — Estado: ${a.status === 'incumplido' ? 'Incumplido' : 'En cumplimiento'}`,
    ).join('<br/>')
    : '';

  const allDiscounts = computeAllTierDiscounts(row, discountTiers);
  const cleanCharges = getCleanChargeLinesAmount(row);
  const grossTotal = round2(cleanCharges + (row.priorBalance || 0) + (row.interestAmount || 0));

  const header = template === 'moderno'
    ? `<div style="background:#1e40af;color:#fff;padding:20px 28px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:20px;font-weight:700;">${orgName}</div>
          <div style="font-size:12px;opacity:.85;margin-top:4px;">${orgAddress} · Tel: ${orgPhone} · ${orgEmail}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:14px;font-weight:bold;background:rgba(255,255,255,0.2);padding:4px 10px;border-radius:4px;">${invoiceNumber}</div>
        </div>
       </div>`
    : `<div style="border-bottom:3px solid #1e40af;padding:16px 28px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:18px;font-weight:700;color:#1e293b;">${orgName}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px;">${orgAddress} · Tel: ${orgPhone} · ${orgEmail}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:14px;font-weight:bold;color:#1e40af;border:1px solid #1e40af;padding:4px 10px;border-radius:4px;">${invoiceNumber}</div>
        </div>
       </div>`;

  let comparativeRowsHtml = '';

  if (row.priorBalance > 0) {
    comparativeRowsHtml += `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#334155;">Saldo Anterior (Periodos Vencidos)</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#b91c1c;font-weight:600;">${formatCOP(row.priorBalance)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#64748b;">$ 0</td>
        <td style="text-align:right;padding:6px 10px;border-bottom:1px solid #f1f5f9;font-weight:700;color:#b91c1c;">${formatCOP(row.priorBalance)}</td>
      </tr>`;
  }

  if (row.chargeLines && row.chargeLines.length > 0) {
    for (const line of row.chargeLines) {
      const name = line.conceptName || line.name || 'Concepto';
      comparativeRowsHtml += `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#334155;">${name}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#64748b;">$ 0</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#0f172a;">${formatCOP(line.amount)}</td>
          <td style="text-align:right;padding:6px 10px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#0f172a;">${formatCOP(line.amount)}</td>
        </tr>`;
    }
  } else if (row.currentCharges > 0) {
    comparativeRowsHtml += `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#334155;">Cuota de Administración / Cargos</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#64748b;">$ 0</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#0f172a;">${formatCOP(row.currentCharges)}</td>
        <td style="text-align:right;padding:6px 10px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#0f172a;">${formatCOP(row.currentCharges)}</td>
      </tr>`;
  }

  if (row.interestAmount > 0) {
    comparativeRowsHtml += `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#d97706;">Interés de Mora (Tasa: ${(row.interestRate || 0).toFixed(2)}% mes)</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#64748b;">$ 0</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#d97706;">${formatCOP(row.interestAmount)}</td>
        <td style="text-align:right;padding:6px 10px;border-bottom:1px solid #f1f5f9;font-weight:700;color:#d97706;">${formatCOP(row.interestAmount)}</td>
      </tr>`;
  }

  const discountsRowsHtml = allDiscounts.map(disc => `
    <tr style="background:#f0fdf4;border-bottom:1px solid #dcfce7;">
      <td colspan="3" style="padding:8px 10px;color:#166534;font-size:11px;">
        Descuento: <strong>${disc.tierName}</strong> (Válido hasta el día ${disc.validUntilDay} del mes)
      </td>
      <td style="text-align:right;padding:8px 10px;color:#166534;font-weight:700;font-size:12px;">
        -${formatCOP(disc.discountVal)}
      </td>
    </tr>
    <tr style="background:#dcfce7;border-bottom:2px solid #bbf7d0;">
      <td colspan="3" style="padding:8px 10px;color:#14532d;font-weight:700;font-size:13px;">
        VALOR A PAGAR CON DESCUENTO (Hasta día ${disc.validUntilDay})
      </td>
      <td style="text-align:right;padding:8px 10px;color:#15803d;font-weight:800;font-size:15px;">
        ${formatCOP(disc.payWithDiscount)}
      </td>
    </tr>
  `).join('');

  const detailSection = `
    <div style="margin-top:16px;">
      <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Estado de Cuenta</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;">
            <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #e2e8f0;width:40%;">Detalle / Concepto</th>
            <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #e2e8f0;width:20%;">Saldo Anterior</th>
            <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #e2e8f0;width:20%;">Cargos Periodo</th>
            <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #e2e8f0;width:20%;">Valor Total</th>
          </tr>
        </thead>
        <tbody>
          ${comparativeRowsHtml}
        </tbody>
      </table>
    </div>

    <div style="margin-top:16px;border:2px solid #1e40af;border-radius:8px;overflow:hidden;">
      <div style="background:#eff6ff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #bfdbfe;">
        <span style="font-size:14px;font-weight:800;color:#1e3a8a;">VALOR A PAGAR (SIN DESCUENTO):</span>
        <span style="font-size:18px;font-weight:900;color:#1e40af;">${formatCOP(grossTotal)}</span>
      </div>

      ${allDiscounts.length > 0 ? `
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <tbody>
            ${discountsRowsHtml}
          </tbody>
        </table>
      ` : ''}
    </div>

    ${template === 'detallado' && hasAgreement ? `
      <div style="margin-top:14px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:11px;color:#92400e;">
        <strong>Estado de Acuerdos de Pago:</strong><br/>${agreementNote}
      </div>
    ` : ''}`;

  return `
  <html><head><meta charset="utf-8"><title>Cuenta de Cobro ${invoiceNumber} - ${row.unit.tower} ${row.unit.unit_label}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin:0; color:#1f2937; }
    .doc { max-width:720px; margin:24px auto; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; }
    .body { padding:20px 28px; }
    h1 { font-size:18px; margin:0 0 4px; }
    .meta { font-size:11px; color:#6b7280; margin-bottom:12px; }
    .prop { background:#f8fafc; padding:12px 16px; border-radius:6px; margin-bottom:12px; font-size:12px; border:1px solid #e2e8f0; }
    .footer { margin-top:20px; font-size:10px; color:#9ca3af; border-top:1px solid #f1f5f9; padding-top:10px; text-align:center; }
  </style></head>
  <body>
    <div class="doc">
      ${header}
      <div class="body">
        <h1>CUENTA DE COBRO N° ${invoiceNumber}</h1>
        <div class="meta">Periodo: ${billingPeriod} · Formato: ${templateLabels[template]}</div>
        
        <div class="prop">
          <table style="width:100%;font-size:12px;border-collapse:collapse;">
            <tr>
              <td style="padding:2px 0;"><strong>Inmueble:</strong> ${row.unit.tower} ${row.unit.unit_label}</td>
              <td style="padding:2px 0;text-align:right;"><strong>Fecha Emisión:</strong> ${issueDateFormatted}</td>
            </tr>
            <tr>
              <td style="padding:2px 0;"><strong>Propietario:</strong> ${row.unit.owner_name || 'N/A'} (Doc: ${row.unit.owner_document || 'N/A'})</td>
              <td style="padding:2px 0;text-align:right;color:#dc2626;"><strong>Fecha Vencimiento:</strong> ${dueDateFormatted}</td>
            </tr>
          </table>
        </div>

        ${detailSection}
        
        <div class="footer">Documento generado por Rela ERP — Módulo de Facturación Pro.</div>
      </div>
    </div>
  </body></html>`;
}

function openPrintWindow(html: string) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
  return true;
}

interface Props {
  liquidation: LiquidationRow[];
  agreements: PaymentAgreement[];
  org: Organization | null;
  billingPeriod: string;
  onBack: () => void;
  discountTiers?: DiscountTier[];
}

export default function Paso2FormatoEnvio({ liquidation, agreements, org, billingPeriod, onBack, discountTiers = [] }: Props) {
  const [template, setTemplate] = useState<TemplateId>('detallado');
  const [previewRow, setPreviewRow] = useState<LiquidationRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [emailSubject, setEmailSubject] = useState(`Cuenta de Cobro - Periodo ${billingPeriod}`);
  const [emailBody, setEmailBody] = useState('');
  const [simulating, setSimulating] = useState(false);
  const [simResults, setSimResults] = useState<SimResult[] | null>(null);
  const [simModalOpen, setSimModalOpen] = useState(false);
  const [error, setError] = useState('');

  const [issueDate, setIssueDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState<string>(() => {
    const [yStr, mStr] = billingPeriod.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const lastDay = new Date(y, m, 0).getDate();
    return `${yStr}-${String(mStr).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  });

  const [isFinalized, setIsFinalized] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [generatedInvoices, setGeneratedInvoices] = useState<{ id: string; invoiceNumber: string; row: LiquidationRow }[]>([]);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const [currentNextSeq, setCurrentNextSeq] = useState<number>(1);

  useEffect(() => {
    async function checkExistingPeriodState() {
      if (!org || !billingPeriod) return;
      try {
        const { data: docConfig } = await supabase
          .from('accounting_documents')
          .select('next_consecutive')
          .eq('organization_id', org.id)
          .eq('prefix', 'CC')
          .single();

        const baseSeq = docConfig?.next_consecutive || 1;
        setCurrentNextSeq(baseSeq);

        const { data: existingInvoices } = await supabase
          .from('invoices')
          .select('*')
          .eq('organization_id', org.id)
          .eq('period', billingPeriod)
          .order('invoice_number', { ascending: true });

        if (existingInvoices && existingInvoices.length > 0) {
          if (existingInvoices[0]?.due_date) {
            setDueDate(existingInvoices[0].due_date);
          }
          if (existingInvoices[0]?.issue_date) {
            setIssueDate(existingInvoices[0].issue_date);
          }

          const restoredInvoices = existingInvoices.map(inv => {
            const matchingRow = liquidation.find(r => r.unit.id === inv.unit_id);
            const fallbackUnit = matchingRow ? matchingRow.unit : { id: inv.unit_id, unit_label: 'S/N', tower: '', organization_id: org.id, coefficient: 0, is_active: true };

            const reconstructedRow: LiquidationRow = {
              unit: matchingRow ? matchingRow.unit : fallbackUnit,
              priorBalance: 0,
              currentCharges: Number(inv.subtotal) || 0,
              chargeLines: Array.isArray(inv.items_snapshot) && inv.items_snapshot.length > 0 ? inv.items_snapshot : (matchingRow?.chargeLines || []),
              interestAmount: Number(inv.interest_amount) || 0,
              discountAmount: Number(inv.discount_amount) || 0,
              netTotal: Number(inv.total_amount) || 0,
              rowId: inv.id,
              invoiceNumber: inv.invoice_number, // Consecutivo real guardado
              issueDate: inv.issue_date,
              dueDate: inv.due_date,
              due: matchingRow?.due,
              interestRate: matchingRow?.interestRate || 0,
            };

            return {
              id: inv.id,
              invoiceNumber: inv.invoice_number,
              row: reconstructedRow,
            };
          });

          setGeneratedInvoices(restoredInvoices);
          setIsFinalized(true);
        }
      } catch (e) {
        console.warn('No se pudo verificar el estado previo del periodo:', e);
      }
    }
    checkExistingPeriodState();
  }, [org, billingPeriod, liquidation]);

  const activeRows = useMemo(() => {
    return isFinalized ? generatedInvoices.map(i => i.row) : liquidation;
  }, [isFinalized, generatedInvoices, liquidation]);

  const recipients: Recipient[] = useMemo(() => {
    return activeRows.map(row => {
      const email = (row.unit.owner_name || '').toLowerCase().replace(/[^a-z0-9]/g, '.');
      const safeEmail = email ? `${email}@email.com` : '';
      return {
        rowId: row.rowId || row.due?.id,
        unitId: row.unit.id,
        propertyName: `${row.unit.tower} ${row.unit.unit_label}`,
        ownerName: row.unit.owner_name || 'N/A',
        email: safeEmail,
        total: row.netTotal,
      };
    });
  }, [activeRows]);

  function toggleSelected(rowId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  }

  function selectAllVisible() { setSelected(new Set(recipients.map(r => r.rowId))); }
  function clearSelection() { setSelected(new Set()); }

  function handlePreview(row: LiquidationRow, idx: number) {
    setPreviewRow(row);
  }

  function openPreviewPdf() {
    if (!previewRow) return;
    const invNum = previewRow.invoiceNumber || (isFinalized ? generatedInvoices.find(i => i.row.rowId === previewRow.rowId)?.invoiceNumber : `CC-${String(currentNextSeq).padStart(4, '0')}`) || 'CC-0061';
    const resolvedIssue = previewRow.issueDate || issueDate;
    const resolvedDue = previewRow.dueDate || dueDate;
    const html = buildPdfHtml(previewRow, template, org, billingPeriod, agreements, invNum, discountTiers, resolvedIssue, resolvedDue);
    openPrintWindow(html);
  }

  function downloadSingle(row: LiquidationRow, idx: number) {
    const invNum = row.invoiceNumber || (isFinalized ? generatedInvoices[idx]?.invoiceNumber : `CC-${String(currentNextSeq + idx).padStart(4, '0')}`) || `CC-${String(currentNextSeq + idx).padStart(4, '0')}`;
    const resolvedIssue = row.issueDate || issueDate;
    const resolvedDue = row.dueDate || dueDate;
    const html = buildPdfHtml(row, template, org, billingPeriod, agreements, invNum, discountTiers, resolvedIssue, resolvedDue);
    openPrintWindow(html);
  }

  function downloadSelectedConsolidated() {
    const rows = activeRows.filter(r => selected.has(r.rowId || r.due?.id));
    if (rows.length === 0) { setError('Seleccione al menos una cuenta para descargar el PDF consolidado.'); return; }
    const pages = rows.map((r) => {
      const foundInv = generatedInvoices.find(i => i.row.rowId === r.rowId);
      const invNum = r.invoiceNumber || foundInv?.invoiceNumber || 'CC-0061';
      const resolvedIssue = r.issueDate || issueDate;
      const resolvedDue = r.dueDate || dueDate;
      return buildPdfHtml(r, template, org, billingPeriod, agreements, invNum, discountTiers, resolvedIssue, resolvedDue);
    }).join('<div style="page-break-after:always;"></div>');
    const html = `<html><head><meta charset="utf-8"><title>Cuentas de Cobro Consolidadas - ${billingPeriod}</title></head><body>${pages}</body></html>`;
    if (!openPrintWindow(html)) setError('No se pudo abrir la ventana de impresión.');
  }

  function downloadSelectedIndividual() {
    const targets = isFinalized
      ? generatedInvoices.filter(i => selected.has(i.row.rowId))
      : liquidation.map((r, idx) => ({ id: r.rowId, invoiceNumber: `CC-${String(currentNextSeq + idx).padStart(4, '0')}`, row: r })).filter(t => selected.has(t.row.rowId));
    
    if (targets.length === 0) { setError('Seleccione al menos una cuenta para descargar.'); return; }
    targets.forEach((t, idx) => {
      setTimeout(() => {
        const invNum = t.row.invoiceNumber || t.invoiceNumber;
        const resolvedIssue = t.row.issueDate || issueDate;
        const resolvedDue = t.row.dueDate || dueDate;
        const html = buildPdfHtml(t.row, template, org, billingPeriod, agreements, invNum, discountTiers, resolvedIssue, resolvedDue);
        openPrintWindow(html);
      }, idx * 600);
    });
  }

  async function handleFinalizeProcess() {
    if (!org) return;
    setFinalizing(true);
    setError('');

    try {
      const periodStartDate = issueDate || `${billingPeriod}-01`;
      const periodEndDate = dueDate || `${billingPeriod}-28`;

      const { data: docConfig } = await supabase
        .from('accounting_documents')
        .select('*')
        .eq('organization_id', org.id)
        .eq('prefix', 'CC')
        .single();

      let nextSeq = docConfig?.next_consecutive || 61;
      setCurrentNextSeq(nextSeq);

      const [{ data: accountsData }, { data: conceptsData }, { data: thirdPartiesData }] = await Promise.all([
        supabase.from('accounts').select('*').eq('organization_id', org.id),
        supabase.from('billing_concepts').select('*').eq('organization_id', org.id),
        supabase.from('third_parties').select('*').eq('organization_id', org.id),
      ]);

      const accounts = accountsData || [];
      const concepts = conceptsData || [];
      const thirdParties = thirdPartiesData || [];

      const conceptMap = new Map<string, any>();
      for (const c of concepts) {
        conceptMap.set(c.id, c);
        if (c.code) conceptMap.set(c.code.toUpperCase(), c);
      }

      const defaultReceivableAcc = accounts.find(a => a.code.startsWith('13')) || accounts[0];
      const defaultIncomeAcc = accounts.find(a => a.code.startsWith('4')) || accounts[1] || accounts[0];

      const batchInvoices = [];

      for (let i = 0; i < liquidation.length; i++) {
        const row = liquidation[i];
        const invoiceNumber = `CC-${String(nextSeq + i).padStart(4, '0')}`;
        const rowId = row.rowId || 'inv-' + Math.random().toString(36).substring(2, 9);

        let assignedThirdPartyId = row.unit.third_party_id || null;
        if (!assignedThirdPartyId && thirdParties.length > 0) {
          const tpMatch = thirdParties.find(t => t.document_number === row.unit.owner_document);
          if (tpMatch) assignedThirdPartyId = tpMatch.id;
        }

        await supabase.from('dues').insert({
          organization_id: org.id,
          unit_id: row.unit.id,
          period: billingPeriod,
          amount: row.netTotal,
          balance: row.netTotal,
          status: 'pendiente',
          due_date: periodEndDate,
        });

        const snapshotItems = row.chargeLines && row.chargeLines.length > 0 ? row.chargeLines : [
          { conceptName: 'Cuota de Administración / Cargos', amount: row.currentCharges }
        ];

        const cleanCharges = getCleanChargeLinesAmount(row);
        const grossTotal = round2(cleanCharges + (row.priorBalance || 0) + (row.interestAmount || 0));

        const { data: invRecord } = await supabase.from('invoices').insert({
          organization_id: org.id,
          unit_id: row.unit.id,
          period: billingPeriod,
          invoice_number: invoiceNumber,
          issue_date: periodStartDate,
          due_date: periodEndDate,
          subtotal: row.currentCharges,
          interest_amount: row.interestAmount,
          discount_amount: row.discountAmount,
          total_amount: grossTotal,
          status: 'pendiente',
          items_snapshot: snapshotItems,
        }).select().single();

        const assignedInvoiceId = invRecord?.id || rowId;

        const reconstructedRow: LiquidationRow = {
          ...row,
          rowId: assignedInvoiceId,
          invoiceNumber: invoiceNumber, // Asignamos el consecutivo real
          issueDate: periodStartDate,
          dueDate: periodEndDate,
        };

        batchInvoices.push({ id: assignedInvoiceId, invoiceNumber, row: reconstructedRow });

        const { data: je, error: jeErr } = await supabase.from('journal_entries').insert({
          organization_id: org.id,
          date: periodStartDate,
          description: `Causación Cuota de Cobro ${invoiceNumber} - ${row.unit.tower ? row.unit.tower + '-' : ''}${row.unit.unit_label} Periodo ${billingPeriod}`,
          document_type: 'CC',
          document_number: nextSeq + i,
          is_manual: true,
        }).select().single();

        if (!jeErr && je) {
          const linesToInsert = [];

          if (row.chargeLines && row.chargeLines.length > 0) {
            for (const cl of row.chargeLines) {
              const conceptDef = conceptMap.get(cl.conceptId) || conceptMap.get(cl.conceptCode?.toUpperCase());
              
              const debitAccId = conceptDef?.counterpart_account_id || defaultReceivableAcc?.id;
              const creditAccId = conceptDef?.income_account_id || defaultIncomeAcc?.id;

              if (cl.amount > 0) {
                if (debitAccId) {
                  linesToInsert.push({
                    journal_entry_id: je.id,
                    account_id: debitAccId,
                    debit: cl.amount,
                    credit: 0,
                    third_party_id: assignedThirdPartyId,
                  });
                }
                if (creditAccId) {
                  linesToInsert.push({
                    journal_entry_id: je.id,
                    account_id: creditAccId,
                    debit: 0,
                    credit: cl.amount,
                    third_party_id: assignedThirdPartyId,
                  });
                }
              }
            }
          }

          if (row.interestAmount > 0) {
            const interestAccId = defaultIncomeAcc?.id;
            if (defaultReceivableAcc?.id && interestAccId) {
              linesToInsert.push({
                journal_entry_id: je.id,
                account_id: defaultReceivableAcc.id,
                debit: row.interestAmount,
                credit: 0,
                third_party_id: assignedThirdPartyId,
              });
              linesToInsert.push({
                journal_entry_id: je.id,
                account_id: interestAccId,
                debit: 0,
                credit: row.interestAmount,
                third_party_id: assignedThirdPartyId,
              });
            }
          }

          if (linesToInsert.length === 0 && row.currentCharges > 0) {
            const debitAccId = defaultReceivableAcc?.id;
            const creditAccId = defaultIncomeAcc?.id;

            if (debitAccId) {
              linesToInsert.push({
                journal_entry_id: je.id,
                account_id: debitAccId,
                debit: row.currentCharges,
                credit: 0,
                third_party_id: assignedThirdPartyId,
              });
            }
            if (creditAccId) {
              linesToInsert.push({
                journal_entry_id: je.id,
                account_id: creditAccId,
                debit: 0,
                credit: row.currentCharges,
                third_party_id: assignedThirdPartyId,
              });
            }
          }

          await supabase.from('journal_lines').insert(linesToInsert);
        }
      }

      if (docConfig) {
        await supabase.from('accounting_documents')
          .update({ next_consecutive: nextSeq + liquidation.length })
          .eq('id', docConfig.id);
      }

      setGeneratedInvoices(batchInvoices);
      setIsFinalized(true);
    } catch (e) {
      console.warn('Error al registrar asientos contables en bloque:', e);
      setError('Ocurrió un inconveniente al contabilizar.');
    }

    setFinalizing(false);
  }

  async function handleDeleteBatch() {
    if (!confirm('¿Está seguro de eliminar toda la facturación de este periodo en bloque? Se reversarán los asientos contables, las facturas emitidas y se liberarán los consecutivos.')) return;
    setDeletingBatch(true);
    setError('');
    try {
      if (org) {
        const { data: duesToDelete } = await supabase
          .from('dues')
          .select('id')
          .eq('organization_id', org.id)
          .eq('period', billingPeriod);

        const countToDelete = duesToDelete?.length || 0;

        await supabase.from('dues').delete().eq('organization_id', org.id).eq('period', billingPeriod);
        await supabase.from('invoices').delete().eq('organization_id', org.id).eq('period', billingPeriod);
        
        const { data: entriesToDelete } = await supabase
          .from('journal_entries')
          .select('id')
          .eq('organization_id', org.id)
          .eq('document_type', 'CC');

        if (entriesToDelete && entriesToDelete.length > 0) {
          const ids = entriesToDelete.map(e => e.id);
          await supabase.from('journal_lines').delete().in('journal_entry_id', ids);
          await supabase.from('journal_entries').delete().in('id', ids);
        }

        if (countToDelete > 0) {
          const { data: docConfig } = await supabase
            .from('accounting_documents')
            .select('*')
            .eq('organization_id', org.id)
            .eq('prefix', 'CC')
            .single();

          if (docConfig) {
            const newConsecutive = Math.max(1, (docConfig.next_consecutive || 1) - countToDelete);
            await supabase.from('accounting_documents')
              .update({ next_consecutive: newConsecutive })
              .eq('id', docConfig.id);
            setCurrentNextSeq(newConsecutive);
          }
        }
      }

      setIsFinalized(false);
      setGeneratedInvoices([]);
      setSelected(new Set());
      setDeletingBatch(false);
    } catch (err) {
      setError('Error al eliminar la facturación en bloque y liberar consecutivos.');
      setDeletingBatch(false);
    }
  }

  async function handleSimulate() {
    if (!emailSubject.trim()) { setError('El asunto del correo es obligatorio.'); return; }
    if (recipients.length === 0) { setError('No hay destinatarios para simular el envío.'); return; }
    setError('');
    setSimulating(true);
    await new Promise(r => setTimeout(r, 600));
    const results: SimResult[] = recipients.map(r => {
      const hasEmail = !!r.email;
      const bounce = !hasEmail || Math.random() < 0.10;
      return {
        recipient: r,
        status: bounce ? 'rebotado' : 'enviado',
        detail: bounce ? (hasEmail ? 'Rebote: buzón no disponible' : 'Rebote: correo no registrado') : 'Envío exitoso (simulado)',
      };
    });
    setSimResults(results);
    setSimulating(false);
    setSimModalOpen(true);
  }

  const selectedCount = selected.size;
  const sentCount = simResults?.filter(r => r.status === 'enviado').length || 0;
  const bouncedCount = simResults?.filter(r => r.status === 'rebotado').length || 0;
  const bodyRemaining = 1000 - emailBody.length;

  return (
    <div className="space-y-6">
      {isFinalized && (
        <div className="rounded-xl bg-green-50 border border-green-200 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-600 text-white flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-green-900">¡Facturación Generada y Contabilizada con Éxito!</h3>
              <p className="text-sm text-green-700">Se han emitido cuentas de cobro para el periodo {billingPeriod}.</p>
            </div>
          </div>
          <Button variant="danger" size="sm" onClick={handleDeleteBatch} disabled={deletingBatch}>
            {deletingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Eliminar Facturación en Bloque
          </Button>
        </div>
      )}

      {!isFinalized && (
        <Card>
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-600"></span>
              Fechas del Documento de Facturación
            </h2>
            <p className="text-sm text-gray-500 mt-1">Defina la fecha de emisión y vencimiento que aparecerán en todas las Cuentas de Cobro.</p>
          </div>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Fecha de Emisión *"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
              <Input
                label="Fecha de Vencimiento *"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600" />
            Plantilla de Cuenta de Cobro
          </h2>
          <p className="text-sm text-gray-500 mt-1">Seleccione el formato de presentación del documento PDF.</p>
        </div>
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => setTemplate(t.id)}
                className={`text-left rounded-xl border p-4 transition-all ${
                  template === t.id ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-gray-900">{t.name}</span>
                  {template === t.id && <CheckCircle2 className="w-4 h-4 text-blue-600" />}
                </div>
                <p className="text-xs text-gray-500">{t.description}</p>
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            {isFinalized ? 'Historial de Cuentas Generadas' : 'Cuentas de Cobro a Generar (Tabla de 4 Columnas)'}
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={selectAllVisible}>Seleccionar visibles</Button>
            <Button variant="ghost" size="sm" onClick={clearSelection} disabled={selectedCount === 0}>Limpiar</Button>
          </div>
        </div>
        {activeRows.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-100 mb-3">
              <FileText className="w-7 h-7 text-gray-400" />
            </div>
            <p className="text-gray-500">No hay cuentas para facturar. Vuelva al Paso 1.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selectedCount === activeRows.length && activeRows.length > 0}
                      onChange={() => selectedCount === activeRows.length ? clearSelection() : selectAllVisible()}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Consecutivo / Propiedad</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Desglose de Conceptos</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Valor sin Descuento</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Valores con Descuento (Escalón 1)</th>
                  <th className="text-center text-xs font-semibold text-gray-600 uppercase px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeRows.map((row, idx) => {
                  const rowId = row.rowId || row.due?.id || idx;
                  const invNum = row.invoiceNumber || (isFinalized ? generatedInvoices[idx]?.invoiceNumber : `CC-${String(currentNextSeq + idx).padStart(4, '0')}`) || `CC-${String(currentNextSeq + idx).padStart(4, '0')}`;
                  
                  const cleanCharges = getCleanChargeLinesAmount(row);
                  const grossTotal = round2(cleanCharges + (row.priorBalance || 0) + (row.interestAmount || 0));
                  const allDiscounts = computeAllTierDiscounts(row, discountTiers);
                  const firstDiscount = allDiscounts[0];

                  return (
                    <tr key={rowId} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(String(rowId))}
                          onChange={() => toggleSelected(String(rowId))}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-800 mb-0.5">{invNum}</span>
                        <p className="text-sm font-medium text-gray-900">{row.unit.tower} {row.unit.unit_label}</p>
                        <p className="text-xs text-gray-500">{row.unit.owner_name || ''}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        <ul className="space-y-0.5">
                          {row.priorBalance > 0 && (
                            <li className="text-red-600 font-medium">• Saldo Anterior: {formatCOP(row.priorBalance)}</li>
                          )}
                          {row.chargeLines && row.chargeLines.length > 0 ? (
                            row.chargeLines.map((line, lIdx) => (
                              <li key={lIdx}>• {line.conceptName || line.name || 'Concepto'}: {formatCOP(line.amount)}</li>
                            ))
                          ) : (
                            row.currentCharges > 0 && <li>• Cuota de Administración / Cargos: {formatCOP(row.currentCharges)}</li>
                          )}
                          {row.interestAmount > 0 && (
                            <li className="text-amber-600 font-medium">• Interés de Mora ({(row.interestRate || 0).toFixed(2)}%): {formatCOP(row.interestAmount)}</li>
                          )}
                          {firstDiscount && firstDiscount.discountVal > 0 && (
                            <li className="text-green-600 font-medium">• Descuento Escalón 1: -{formatCOP(firstDiscount.discountVal)}</li>
                          )}
                        </ul>
                      </td>
                      <td className="px-4 py-3 text-right text-base font-extrabold text-blue-900">
                        {formatCOP(grossTotal)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        {firstDiscount && firstDiscount.discountVal > 0 ? (
                          <div className="bg-green-50 p-1.5 rounded border border-green-200">
                            <p className="text-[10px] text-green-700 font-medium">Hasta el día {firstDiscount.validUntilDay}:</p>
                            <p className="text-sm font-bold text-green-800">{formatCOP(firstDiscount.payWithDiscount)}</p>
                          </div>
                        ) : (
                          <span className="text-gray-400">Sin descuento</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => handlePreview(row, idx)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50" title="Ver PDF">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button onClick={() => downloadSingle(row, idx)} className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50" title="Descargar PDF">
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {activeRows.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-200 flex flex-wrap items-center gap-3 bg-gray-50">
            <span className="text-sm text-gray-600">{selectedCount} seleccionada(s)</span>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={downloadSelectedConsolidated} disabled={selectedCount === 0}>
              <FileStack className="w-4 h-4" /> Descargar PDF Consolidado
            </Button>
            <Button variant="outline" size="sm" onClick={downloadSelectedIndividual} disabled={selectedCount === 0}>
              <Download className="w-4 h-4" /> Descargar Individuales
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-600" />
            Envío por Correo Electrónico
          </h2>
          <p className="text-sm text-gray-500 mt-1">Configure el mensaje y seleccione los destinatarios.</p>
        </div>
        <CardBody>
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4">
            <Input label="Asunto del Correo *" type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Ej: Cuenta de Cobro - Periodo" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cuerpo del Correo <span className="text-gray-400">(máx. 1000 caracteres)</span></label>
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value.slice(0, 1000))}
                rows={4}
                placeholder="Estimado propietario, adjuntamos su cuenta de cobro..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">{bodyRemaining} caracteres restantes</p>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <Button onClick={handleSimulate} disabled={simulating || selectedCount === 0}>
              {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Simular Envío Masivo
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-200">
        <Button variant="outline" onClick={onBack}>Volver</Button>
        <div className="flex items-center gap-3">
          {!isFinalized ? (
            <Button onClick={handleFinalizeProcess} disabled={finalizing}>
              {finalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Finalizar y Contabilizar Periodo
            </Button>
          ) : (
            <span className="text-sm font-bold text-green-700 flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> Periodo Finalizado y Contabilizado Exitosamente
            </span>
          )}
        </div>
      </div>

      <Modal open={!!previewRow} onClose={() => setPreviewRow(null)} title={`Vista Previa — ${previewRow?.unit.tower} ${previewRow?.unit.unit_label}`} size="lg">
        {previewRow && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Badge variant="blue">Plantilla: {templateLabels[template]}</Badge>
              <Button size="sm" onClick={openPreviewPdf}><Download className="w-4 h-4" /> Descargar PDF</Button>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5 max-h-[60vh] overflow-y-auto text-sm space-y-3">
              <div className="border-b pb-2 flex justify-between items-center">
                <div>
                  <p className="font-bold text-base">CUENTA DE COBRO</p>
                  <p className="text-xs text-gray-500">Periodo: {billingPeriod}</p>
                </div>
                <div className="text-right text-xs">
                  <p><strong>Fecha Emisión:</strong> {previewRow.issueDate ? formatShortDate(previewRow.issueDate) : formatShortDate(issueDate)}</p>
                  <p className="text-red-600"><strong>Fecha Vencimiento:</strong> {previewRow.dueDate ? formatShortDate(previewRow.dueDate) : formatShortDate(dueDate)}</p>
                </div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <p><strong>Inmueble:</strong> {previewRow.unit.tower} {previewRow.unit.unit_label}</p>
                <p><strong>Propietario:</strong> {previewRow.unit.owner_name}</p>
              </div>

              <div className="space-y-1">
                <p className="font-bold text-xs text-gray-700 uppercase">Estado de Cuenta:</p>
                <div className="border rounded overflow-hidden text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-gray-700 border-b">
                        <th className="p-2 w-[40%]">Detalle / Concepto</th>
                        <th className="p-2 w-[20%]">Saldo Anterior</th>
                        <th className="p-2 w-[20%]">Cargos Periodo</th>
                        <th className="p-2 w-[20%] text-right">Valor Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {previewRow.priorBalance > 0 && (
                        <tr className="text-red-600 font-medium">
                          <td className="p-2">Saldo Anterior (Periodos Vencidos)</td>
                          <td className="p-2">{formatCOP(previewRow.priorBalance)}</td>
                          <td className="p-2 text-gray-400">$ 0</td>
                          <td className="p-2 text-right">{formatCOP(previewRow.priorBalance)}</td>
                        </tr>
                      )}
                      {previewRow.chargeLines && previewRow.chargeLines.length > 0 ? (
                        previewRow.chargeLines.map((line, lIdx) => (
                          <tr key={lIdx}>
                            <td className="p-2">{line.conceptName || line.name || 'Concepto'}</td>
                            <td className="p-2 text-gray-400">$ 0</td>
                            <td className="p-2">{formatCOP(line.amount)}</td>
                            <td className="p-2 text-right font-medium">{formatCOP(line.amount)}</td>
                          </tr>
                        ))
                      ) : (
                        previewRow.currentCharges > 0 && (
                          <tr>
                            <td className="p-2">Cuota de Administración / Cargos</td>
                            <td className="p-2 text-gray-400">$ 0</td>
                            <td className="p-2">{formatCOP(previewRow.currentCharges)}</td>
                            <td className="p-2 text-right font-medium">{formatCOP(previewRow.currentCharges)}</td>
                          </tr>
                        )
                      )}
                      {previewRow.interestAmount > 0 && (
                        <tr className="text-amber-600">
                          <td className="p-2">Interés de Mora (Tasa: {(previewRow.interestRate || 0).toFixed(2)}% mes)</td>
                          <td className="p-2 text-gray-400">$ 0</td>
                          <td className="p-2">{formatCOP(previewRow.interestAmount)}</td>
                          <td className="p-2 text-right font-medium">{formatCOP(previewRow.interestAmount)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border-t pt-2 space-y-2">
                <div className="flex justify-between font-extrabold text-base text-blue-900 bg-blue-50 p-2 rounded">
                  <span>VALOR A PAGAR (SIN DESCUENTO):</span>
                  <span>{formatCOP(round2(getCleanChargeLinesAmount(previewRow) + (previewRow.priorBalance || 0) + (previewRow.interestAmount || 0)))}</span>
                </div>

                {computeAllTierDiscounts(previewRow, discountTiers).map(d => (
                  <div key={d.tierId} className="flex justify-between items-center bg-green-50 p-2 rounded text-xs border border-green-200">
                    <div>
                      <span className="font-bold text-green-800">VALOR A PAGAR CON DESCUENTO</span>
                      <span className="block text-[10px] text-green-600">(Válido hasta el día {d.validUntilDay})</span>
                    </div>
                    <span className="font-extrabold text-sm text-green-700">{formatCOP(d.payWithDiscount)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end"><Button variant="outline" onClick={() => setPreviewRow(null)}>Cerrar</Button></div>
          </div>
        )}
      </Modal>

      <Modal open={simModalOpen} onClose={() => setSimModalOpen(false)} title="Reporte de Simulación" size="md">
        {simResults && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Envíos simulados con éxito: <strong>{sentCount}</strong> / Rebotados: <strong>{bouncedCount}</strong></p>
            <div className="flex justify-end"><Button onClick={() => setSimModalOpen(false)}>Cerrar</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}