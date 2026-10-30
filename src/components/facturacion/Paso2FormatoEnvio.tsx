import { useMemo, useState, useEffect } from 'react';
import {
  FileText, Eye, Download, Mail, Send, CheckCircle2, AlertTriangle,
  Search, Loader2, Info, Layers, FileStack, Users, Trash2
} from 'lucide-react';
import { Unit, Due, PaymentAgreement, BillingConcept, ThirdParty } from '@/lib/supabase';
import { Organization, supabase } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { formatCOP, formatShortDate } from '@/lib/format';

export interface ChargeLine {
  conceptId: string;
  conceptName: string;
  conceptCode: string;
  amount: number;
  isQuota: boolean;
  isNovelty: boolean;
}

export interface LiquidationRow {
  due: Due;
  unit: Unit;
  daysLate: number;
  interestRate: number;
  priorBalance: number;
  currentCharges: number;
  chargeLines: ChargeLine[];
  interestAmount: number;
  discountAmount: number;
  netTotal: number;
  totalWithInterest: number;
  baseAmount: number;
  rowId: string;
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
  { id: 'clasico', name: 'Clásico', description: 'Formato tradicional con encabezado corporativo y tabla compacta.' },
  { id: 'moderno', name: 'Moderno', description: 'Diseño limpio con secciones resaltadas y tipografía actualizada.' },
  { id: 'detallado', name: 'Detallado', description: 'Incluye desglose completo de conceptos, intereses, descuentos y acuerdo de pago.' },
];

const templateLabels: Record<TemplateId, string> = {
  clasico: 'Clásico',
  moderno: 'Moderno',
  detallado: 'Detallado',
};

function round2(v: number): number { return Math.round(v * 100) / 100; }

function buildPdfHtml(
  row: LiquidationRow,
  template: TemplateId,
  org: Organization | null,
  billingPeriod: string,
  agreements: PaymentAgreement[],
  invoiceNumber: string = 'CC-0061',
): string {
  const orgName = org?.name || 'Organización';
  const orgAddress = org?.address || '';
  const orgPhone = org?.phone || '';
  const orgEmail = org?.email || '';
  const today = formatShortDate(new Date().toISOString());
  const unitAgreements = agreements.filter(a => a.unit_id === row.unit.id);
  const agreementNote = unitAgreements.length > 0
    ? unitAgreements.map(a =>
      `Acuerdo activo: ${a.start_period} a ${a.end_period}, cuota ${formatCOP(a.monthly_amount)} — Estado: ${a.status === 'incumplido' ? 'Incumplido' : 'En cumplimiento'}`,
    ).join('<br/>')
    : 'Sin acuerdo de pago vigente.';

  const hasPriorBalance = row.priorBalance > 0;
  const hasDiscount = row.discountAmount > 0;
  const grossTotal = round2(row.currentCharges + row.priorBalance + row.interestAmount);

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

  const chargeLineRows = row.chargeLines.map(line =>
    `<tr><td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;">${line.conceptName}</td><td style="text-align:right;padding:5px 8px;border-bottom:1px solid #f1f5f9;">${formatCOP(line.amount)}</td></tr>`
  ).join('');

  const detailSection = template === 'detallado' ? `
    <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:11px;">
      <thead><tr style="background:#f1f5f9;">
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0;">Concepto</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #e2e8f0;">Valor</th>
      </tr></thead>
      <tbody>
        ${hasPriorBalance ? `<tr><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">Saldo anterior (periodos vencidos)</td><td style="text-align:right;padding:6px 8px;border-bottom:1px solid #f1f5f9;">${formatCOP(row.priorBalance)}</td></tr>` : ''}
        ${chargeLineRows}
        ${row.interestAmount > 0 ? `<tr><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">Interés de mora (${row.interestRate.toFixed(2)}%)</td><td style="text-align:right;padding:6px 8px;border-bottom:1px solid #f1f5f9;">${formatCOP(row.interestAmount)}</td></tr>` : ''}
        <tr style="font-weight:600;background:#f8fafc;"><td style="padding:6px 8px;">Valor Total (Sin Descuento)</td><td style="text-align:right;padding:6px 8px;">${formatCOP(grossTotal)}</td></tr>
        ${hasDiscount ? `<tr style="color:#dc2626;background:#fef2f2;"><td style="padding:6px 8px;border-bottom:1px solid #fee2e2;">Descuento por Pronto Pago (Aplica hasta fecha límite)</td><td style="text-align:right;padding:6px 8px;border-bottom:1px solid #fee2e2;">-${formatCOP(row.discountAmount)}</td></tr>` : ''}
        <tr style="font-weight:700;background:#eff6ff;font-size:12px;color:#1e40af;"><td style="padding:8px;">VALOR NETO A PAGAR</td><td style="text-align:right;padding:8px;">${formatCOP(row.netTotal)}</td></tr>
      </tbody>
    </table>
    <div style="margin-top:14px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:11px;color:#92400e;">
      <strong>Nota del acuerdo de pago:</strong><br/>${agreementNote}
    </div>` : `
    <div style="margin-top:12px;display:flex;justify-content:space-between;font-size:12px;"><span>Saldo anterior:</span><strong>${formatCOP(row.priorBalance)}</strong></div>
    <div style="font-size:12px;display:flex;justify-content:space-between;"><span>Cargos del periodo:</span><strong>${formatCOP(row.currentCharges)}</strong></div>
    ${row.interestAmount > 0 ? `<div style="font-size:12px;display:flex;justify-content:space-between;"><span>Interés de mora (${row.interestRate.toFixed(2)}%):</span><strong>${formatCOP(row.interestAmount)}</strong></div>` : ''}
    <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #cbd5e1;font-size:12px;display:flex;justify-content:space-between;"><span>Total sin descuento:</span><strong>${formatCOP(grossTotal)}</strong></div>
    ${hasDiscount ? `<div style="font-size:12px;display:flex;justify-content:space-between;color:#dc2626;"><span>Descuento por pronto pago:</span><strong>-${formatCOP(row.discountAmount)}</strong></div>` : ''}
    <div style="margin-top:8px;padding-top:8px;border-top:2px solid #1e40af;font-size:14px;font-weight:700;display:flex;justify-content:space-between;color:#1e40af;"><span>VALOR NETO A PAGAR:</span><span>${formatCOP(row.netTotal)}</span></div>`;

  return `
  <html><head><meta charset="utf-8"><title>Cuenta de Cobro ${invoiceNumber} - ${row.unit.tower} ${row.unit.unit_label}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin:0; color:#1f2937; }
    .doc { max-width:720px; margin:24px auto; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; }
    .body { padding:20px 28px; }
    h1 { font-size:18px; margin:0 0 4px; }
    .meta { font-size:11px; color:#6b7280; margin-bottom:12px; }
    .prop { background:#f8fafc; padding:12px 16px; border-radius:6px; margin-bottom:12px; font-size:13px; }
    .footer { margin-top:20px; font-size:10px; color:#9ca3af; border-top:1px solid #f1f5f9; padding-top:10px; }
  </style></head>
  <body>
    <div class="doc">
      ${header}
      <div class="body">
        <h1>CUENTA DE COBRO N° ${invoiceNumber}</h1>
        <div class="meta">Periodo: ${billingPeriod} · Fecha de emisión: ${today} · Formato: ${templateLabels[template]}</div>
        <div class="prop">
          <strong>Propiedad:</strong> ${row.unit.tower} ${row.unit.unit_label}<br/>
          <strong>Propietario:</strong> ${row.unit.owner_name || 'N/A'} · CC/NIT: ${row.unit.owner_document || 'N/A'}<br/>
          <strong>Periodo de la cuota:</strong> ${row.due.period} · Vence: ${formatShortDate(row.due.due_date)}
        </div>
        ${detailSection}
        <div class="footer">Documento generado por Rela ERP — MOD-05 Proceso de Facturación.</div>
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
  onComplete: () => void;
}

export default function Paso2FormatoEnvio({ liquidation, agreements, org, billingPeriod, onBack, onComplete }: Props) {
  const [template, setTemplate] = useState<TemplateId>('detallado');
  const [previewRow, setPreviewRow] = useState<LiquidationRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [emailSubject, setEmailSubject] = useState(`Cuenta de Cobro - Periodo ${billingPeriod}`);
  const [emailBody, setEmailBody] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientFilter, setRecipientFilter] = useState<'all' | 'with_email' | 'without_email'>('all');
  const [simulating, setSimulating] = useState(false);
  const [simResults, setSimResults] = useState<SimResult[] | null>(null);
  const [simModalOpen, setSimModalOpen] = useState(false);
  const [error, setError] = useState('');

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

        const { data: existingDues } = await supabase
          .from('dues')
          .select('*')
          .eq('organization_id', org.id)
          .eq('period', billingPeriod);

        if (existingDues && existingDues.length > 0) {
          const restoredInvoices = liquidation.map((row, idx) => ({
            id: row.rowId || row.due.id,
            invoiceNumber: `CC-${String(baseSeq + idx).padStart(4, '0')}`,
            row,
          }));
          setGeneratedInvoices(restoredInvoices);
          setIsFinalized(true);
        }
      } catch (e) {
        console.warn('No se pudo verificar el estado previo del periodo:', e);
      }
    }
    checkExistingPeriodState();
  }, [org, billingPeriod, liquidation]);

  const recipients: Recipient[] = useMemo(() => {
    return liquidation.map(row => {
      const email = (row.unit.owner_name || '').toLowerCase().replace(/[^a-z0-9]/g, '.');
      const safeEmail = email ? `${email}@email.com` : '';
      return {
        rowId: row.rowId || row.due.id,
        unitId: row.unit.id,
        propertyName: `${row.unit.tower} ${row.unit.unit_label}`,
        ownerName: row.unit.owner_name || 'N/A',
        email: safeEmail,
        total: row.netTotal,
      };
    });
  }, [liquidation]);

  const filteredRecipients = useMemo(() => {
    return recipients.filter(r => {
      if (recipientFilter === 'with_email' && !r.email) return false;
      if (recipientFilter === 'without_email' && r.email) return false;
      if (recipientSearch) {
        const q = recipientSearch.toLowerCase();
        if (!`${r.propertyName} ${r.ownerName} ${r.email}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [recipients, recipientFilter, recipientSearch]);

  function toggleSelected(rowId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  }

  function selectAllVisible() { setSelected(new Set(filteredRecipients.map(r => r.rowId))); }
  function clearSelection() { setSelected(new Set()); }

  function handlePreview(row: LiquidationRow) { setPreviewRow(row); }

  function openPreviewPdf() {
    if (!previewRow) return;
    const html = buildPdfHtml(previewRow, template, org, billingPeriod, agreements, `CC-${String(currentNextSeq).padStart(4, '0')}`);
    openPrintWindow(html);
  }

  function downloadSingle(row: LiquidationRow, invNum = `CC-${String(currentNextSeq).padStart(4, '0')}`) {
    const html = buildPdfHtml(row, template, org, billingPeriod, agreements, invNum);
    openPrintWindow(html);
  }

  function downloadSelectedConsolidated() {
    const rows = isFinalized 
      ? generatedInvoices.filter(i => selected.has(i.id)).map(i => i.row)
      : liquidation.filter(r => selected.has(r.rowId || r.due.id));
    if (rows.length === 0) { setError('Seleccione al menos una cuenta para descargar el PDF consolidado.'); return; }
    const pages = rows.map((r, idx) => {
      const invNum = isFinalized ? generatedInvoices[idx]?.invoiceNumber : `CC-${String(currentNextSeq + idx).padStart(4, '0')}`;
      return buildPdfHtml(r, template, org, billingPeriod, agreements, invNum);
    }).join('<div style="page-break-after:always;"></div>');
    const html = `<html><head><meta charset="utf-8"><title>Cuentas de Cobro Consolidadas - ${billingPeriod}</title></head><body>${pages}</body></html>`;
    if (!openPrintWindow(html)) setError('No se pudo abrir la ventana de impresión.');
  }

  function downloadSelectedIndividual() {
    const targets = isFinalized
      ? generatedInvoices.filter(i => selected.has(i.id))
      : liquidation.filter(r => selected.has(r.rowId || r.due.id)).map((r, idx) => ({ id: r.rowId, invoiceNumber: `CC-${String(currentNextSeq + idx).padStart(4, '0')}`, row: r }));
    if (targets.length === 0) { setError('Seleccione al menos una cuenta para descargar.'); return; }
    targets.forEach((t, idx) => {
      setTimeout(() => {
        const html = buildPdfHtml(t.row, template, org, billingPeriod, agreements, t.invoiceNumber);
        openPrintWindow(html);
      }, idx * 600);
    });
  }

  async function handleFinalizeProcess() {
    if (!org) return;
    setFinalizing(true);
    setError('');

    try {
      const [yearStr, monthStr] = billingPeriod.split('-');
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const lastDayDate = new Date(year, month, 0); 
      const periodEndDate = !isNaN(lastDayDate.getTime()) 
        ? lastDayDate.toISOString().slice(0, 10) 
        : new Date().toISOString().slice(0, 10);

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
      const concepts = conceptsData || [] as BillingConcept[];
      const thirdParties = thirdPartiesData || [] as ThirdParty[];

      // Mapeo exhaustivo de conceptos para extraer sus cuentas parametrizadas
      const conceptMap = new Map<string, BillingConcept>();
      for (const c of concepts) {
        conceptMap.set(c.id, c);
        if (c.code) conceptMap.set(c.code.toUpperCase(), c);
      }

      const defaultReceivableAcc = accounts.find(a => a.code.startsWith('1345') || a.code.startsWith('13')) || accounts[0];
      const defaultIncomeAcc = accounts.find(a => a.code.startsWith('4170') || a.code.startsWith('4')) || accounts[1] || accounts[0];

      const batchInvoices = [];

      for (let i = 0; i < liquidation.length; i++) {
        const row = liquidation[i];
        const invoiceNumber = `CC-${String(nextSeq + i).padStart(4, '0')}`;
        const rowId = row.rowId || 'inv-' + Math.random().toString(36).substring(2, 9);

        batchInvoices.push({
          id: rowId,
          invoiceNumber,
          row,
        });

        // Búsqueda estricta del tercero por el ID del inmueble (Torre-Unidad o Unidad) o ID directo
        let assignedThirdPartyId = row.unit.third_party_id || null;
        if (!assignedThirdPartyId && thirdParties.length > 0) {
          const expectedUnitIdIdentifier = row.unit.tower 
            ? `${row.unit.tower}-${row.unit.unit_label}`.trim() 
            : `${row.unit.unit_label}`.trim();

          const tpMatch = thirdParties.find(t => 
            t.document_number === row.unit.owner_document || 
            t.document_number === expectedUnitIdIdentifier || 
            t.name?.toLowerCase() === row.unit.owner_name?.toLowerCase() ||
            t.name?.toLowerCase() === expectedUnitIdIdentifier.toLowerCase()
          );
          if (tpMatch) assignedThirdPartyId = tpMatch.id;
        }
        if (!assignedThirdPartyId && thirdParties.length > 0) {
          assignedThirdPartyId = thirdParties[0].id;
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

        const { data: je, error: jeErr } = await supabase.from('journal_entries').insert({
          organization_id: org.id,
          date: periodEndDate,
          description: `Causación Cuota de Cobro ${invoiceNumber} - ${row.unit.tower ? row.unit.tower + '-' : ''}${row.unit.unit_label} Periodo ${billingPeriod}`,
          document_type: 'CC',
          document_number: nextSeq + i,
          is_manual: true,
        }).select().single();

        if (!jeErr && je && defaultReceivableAcc) {
          const linesToInsert = [];

          // 1. Débito a la cuenta por cobrar (Contrapartida configurada en el concepto, ej: 13452501)
          let receivableAccId = defaultReceivableAcc.id;
          if (row.chargeLines && row.chargeLines.length > 0) {
            const firstConcept = conceptMap.get(row.chargeLines[0].conceptId) || conceptMap.get(row.chargeLines[0].conceptCode?.toUpperCase());
            if (firstConcept?.counterparty_account_id) {
              receivableAccId = firstConcept.counterparty_account_id;
            }
          }

          linesToInsert.push({
            journal_entry_id: je.id,
            account_id: receivableAccId,
            debit: row.netTotal,
            credit: 0,
            third_party_id: assignedThirdPartyId,
          });

          // 2. Créditos tomados ESTRICTAMENTE de la parametrización de cada concepto de ingreso (ej: 41701001)
          if (row.chargeLines && row.chargeLines.length > 0) {
            for (const cl of row.chargeLines) {
              const conceptDef = conceptMap.get(cl.conceptId) || conceptMap.get(cl.conceptCode?.toUpperCase());
              const targetAccId = conceptDef?.income_account_id || conceptDef?.account_id || defaultIncomeAcc?.id;
              if (targetAccId && cl.amount > 0) {
                linesToInsert.push({
                  journal_entry_id: je.id,
                  account_id: targetAccId,
                  debit: 0,
                  credit: cl.amount,
                  third_party_id: assignedThirdPartyId,
                });
              }
            }
          }

          // 3. Crédito específico por Intereses de Mora respetando su parametrización (Cuentas de Orden / Contra-cuenta)
          if (row.interestAmount && row.interestAmount > 0) {
            const interestConceptDef = Array.from(conceptMap.values()).find(c => c.code?.includes('MORA') || c.name?.toLowerCase().includes('interés'));
            const interestAccId = interestConceptDef?.income_account_id || interestConceptDef?.account_id || accounts.find(a => a.code.startsWith('8') || a.code.startsWith('42'))?.id || defaultIncomeAcc?.id;

            if (interestAccId) {
              linesToInsert.push({
                journal_entry_id: je.id,
                account_id: interestAccId,
                debit: 0,
                credit: row.interestAmount,
                third_party_id: assignedThirdPartyId,
              });
            }
          }

          if (linesToInsert.length === 1) {
            linesToInsert.push({
              journal_entry_id: je.id,
              account_id: defaultIncomeAcc?.id || defaultReceivableAcc.id,
              debit: 0,
              credit: row.netTotal,
              third_party_id: assignedThirdPartyId,
            });
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
      setError('Ocurrió un inconveniente al contabilizar, pero se generó localmente.');
    }

    setFinalizing(false);
  }

  async function handleDeleteBatch() {
    if (!confirm('¿Está seguro de eliminar toda la facturación de este periodo en bloque? Se reversarán los asientos contables y se liberarán los consecutivos.')) return;
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
              <p className="text-sm text-green-700">Se han emitido {generatedInvoices.length} cuentas de cobro consecutivas (desde CC-{String(currentNextSeq).padStart(4, '0')}) con fecha del periodo {billingPeriod}.</p>
            </div>
          </div>
          <Button variant="danger" size="sm" onClick={handleDeleteBatch} disabled={deletingBatch}>
            {deletingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Eliminar Facturación en Bloque
          </Button>
        </div>
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
            {isFinalized ? 'Historial de Cuentas Generadas' : 'Cuentas de Cobro a Generar'}
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={selectAllVisible}>Seleccionar visibles</Button>
            <Button variant="ghost" size="sm" onClick={clearSelection} disabled={selectedCount === 0}>Limpiar</Button>
          </div>
        </div>
        {liquidation.length === 0 ? (
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
                      checked={selectedCount === liquidation.length && liquidation.length > 0}
                      onChange={() => selectedCount === liquidation.length ? clearSelection() : selectAllVisible()}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Consecutivo / Propiedad</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3 hidden sm:table-cell">Saldo Anterior</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Cargos Periodo</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3 hidden md:table-cell">Descuento Pronto Pago</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Neto a Pagar</th>
                  <th className="text-center text-xs font-semibold text-gray-600 uppercase px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {liquidation.map((row, idx) => {
                  const rowId = row.rowId || row.due.id;
                  const invNum = isFinalized ? generatedInvoices[idx]?.invoiceNumber : `CC-${String(currentNextSeq + idx).padStart(4, '0')}`;
                  return (
                    <tr key={rowId} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(rowId)}
                          onChange={() => toggleSelected(rowId)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-800 mb-0.5">{invNum}</span>
                        <p className="text-sm font-medium text-gray-900">{row.unit.tower} {row.unit.unit_label}</p>
                        <p className="text-xs text-gray-500">{row.unit.owner_name || ''}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-700 hidden sm:table-cell">
                        {row.priorBalance > 0 ? formatCOP(row.priorBalance) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-900">{formatCOP(row.currentCharges)}</td>
                      <td className="px-4 py-3 text-right text-sm text-red-600 hidden md:table-cell">
                        {row.discountAmount > 0 ? `-${formatCOP(row.discountAmount)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">{formatCOP(row.netTotal)}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => handlePreview(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50" title="Ver PDF">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button onClick={() => downloadSingle(row, invNum)} className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50" title="Descargar PDF">
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
        {liquidation.length > 0 && (
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
        <Button variant="outline" onClick={onBack}>Volver a Descuentos</Button>
        <div className="flex items-center gap-3">
          {!isFinalized ? (
            <Button onClick={handleFinalizeProcess} disabled={finalizing}>
              {finalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Finalizar y Contabilizar Periodo
            </Button>
          ) : (
            <span className="text-sm font-bold text-green-700 flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> Proceso Concluido Exitosamente
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
            <div className="rounded-lg border border-gray-200 bg-white p-5 max-h-[60vh] overflow-y-auto text-sm">
              <p className="font-bold text-base mb-1">CUENTA DE COBRO</p>
              <p className="text-xs text-gray-500 mb-3">Periodo: {billingPeriod}</p>
              <div className="bg-gray-50 p-3 rounded mb-3">
                <p><strong>Inmueble:</strong> {previewRow.unit.tower} {previewRow.unit.unit_label}</p>
                <p><strong>Propietario:</strong> {previewRow.unit.owner_name}</p>
              </div>
              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between"><span>Cargos del periodo:</span><strong>{formatCOP(previewRow.currentCharges)}</strong></div>
                {previewRow.discountAmount > 0 && (
                  <div className="flex justify-between text-red-600"><span>Descuento pronto pago:</span><strong>-{formatCOP(previewRow.discountAmount)}</strong></div>
                )}
                <div className="flex justify-between font-bold text-blue-700 border-t pt-1"><span>Neto a Pagar:</span><span>{formatCOP(previewRow.netTotal)}</span></div>
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