import { useMemo, useState } from 'react';
import {
  FileText, Eye, Download, Mail, Send, CheckCircle2, AlertTriangle,
  Search, Loader2, Info, Layers, FileStack, Users,
} from 'lucide-react';
import { Unit, Due, PaymentAgreement } from '@/lib/supabase';
import { Organization } from '@/lib/supabase';
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
  { id: 'detallado', name: 'Detallado', description: 'Incluye desglose completo de conceptos, intereses y acuerdo de pago.' },
];

const templateLabels: Record<TemplateId, string> = {
  clasico: 'Clásico',
  moderno: 'Moderno',
  detallado: 'Detallado',
};

function buildPdfHtml(
  row: LiquidationRow,
  template: TemplateId,
  org: Organization | null,
  billingPeriod: string,
  agreements: PaymentAgreement[],
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

  const header = template === 'moderno'
    ? `<div style="background:#1e40af;color:#fff;padding:20px 28px;border-radius:8px 8px 0 0;">
        <div style="font-size:20px;font-weight:700;">${orgName}</div>
        <div style="font-size:12px;opacity:.85;margin-top:4px;">${orgAddress} · Tel: ${orgPhone} · ${orgEmail}</div>
       </div>`
    : `<div style="border-bottom:3px solid #1e40af;padding:16px 28px;">
        <div style="font-size:18px;font-weight:700;color:#1e293b;">${orgName}</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px;">${orgAddress} · Tel: ${orgPhone} · ${orgEmail}</div>
       </div>`;

  // Build itemized charge lines rows
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
        ${hasDiscount ? `<tr style="color:#dc2626;"><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">Descuento por pronto pago</td><td style="text-align:right;padding:6px 8px;border-bottom:1px solid #f1f5f9;">-${formatCOP(row.discountAmount)}</td></tr>` : ''}
        <tr style="font-weight:700;background:#f8fafc;"><td style="padding:6px 8px;">Saldo neto a pagar</td><td style="text-align:right;padding:6px 8px;">${formatCOP(row.netTotal)}</td></tr>
      </tbody>
    </table>
    <div style="margin-top:14px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:11px;color:#92400e;">
      <strong>Nota del acuerdo de pago:</strong><br/>${agreementNote}
    </div>` : `
    <div style="margin-top:12px;display:flex;justify-content:space-between;font-size:12px;"><span>Saldo anterior:</span><strong>${formatCOP(row.priorBalance)}</strong></div>
    <div style="font-size:12px;display:flex;justify-content:space-between;"><span>Cargos del periodo:</span><strong>${formatCOP(row.currentCharges)}</strong></div>
    ${row.interestAmount > 0 ? `<div style="font-size:12px;display:flex;justify-content:space-between;"><span>Interés de mora (${row.interestRate.toFixed(2)}%):</span><strong>${formatCOP(row.interestAmount)}</strong></div>` : ''}
    ${hasDiscount ? `<div style="font-size:12px;display:flex;justify-content:space-between;color:#dc2626;"><span>Descuento por pronto pago:</span><strong>-${formatCOP(row.discountAmount)}</strong></div>` : ''}
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:14px;font-weight:700;display:flex;justify-content:space-between;"><span>Total a pagar:</span><span>${formatCOP(row.netTotal)}</span></div>`;

  return `
  <html><head><meta charset="utf-8"><title>Cuenta de Cobro - ${row.unit.tower} ${row.unit.unit_label}</title>
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
        <h1>CUENTA DE COBRO</h1>
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

  function selectAllVisible() {
    setSelected(new Set(filteredRecipients.map(r => r.rowId)));
  }
  function clearSelection() { setSelected(new Set()); }

  function handlePreview(row: LiquidationRow) {
    setPreviewRow(row);
  }

  function openPreviewPdf() {
    if (!previewRow) return;
    const html = buildPdfHtml(previewRow, template, org, billingPeriod, agreements);
    openPrintWindow(html);
  }

  function downloadSingle(row: LiquidationRow) {
    const html = buildPdfHtml(row, template, org, billingPeriod, agreements);
    openPrintWindow(html);
  }

  function downloadSelectedConsolidated() {
    const rows = liquidation.filter(r => selected.has(r.rowId || r.due.id));
    if (rows.length === 0) { setError('Seleccione al menos una cuenta para descargar el PDF consolidado.'); return; }
    const pages = rows.map(r => buildPdfHtml(r, template, org, billingPeriod, agreements)).join('<div style="page-break-after:always;"></div>');
    const html = `<html><head><meta charset="utf-8"><title>Cuentas de Cobro Consolidadas - ${billingPeriod}</title></head><body>${pages}</body></html>`;
    if (!openPrintWindow(html)) setError('No se pudo abrir la ventana de impresión. Verifique el bloqueador de ventanas emergentes.');
  }

  function downloadSelectedIndividual() {
    const rows = liquidation.filter(r => selected.has(r.rowId || r.due.id));
    if (rows.length === 0) { setError('Seleccione al menos una cuenta para descargar los PDF individuales.'); return; }
    rows.forEach((row, idx) => {
      setTimeout(() => {
        const html = buildPdfHtml(row, template, org, billingPeriod, agreements);
        openPrintWindow(html);
      }, idx * 600);
    });
  }

  async function handleSimulate() {
    if (!emailSubject.trim()) { setError('El asunto del correo es obligatorio.'); return; }
    if (recipients.length === 0) { setError('No hay destinatarios para simular el envío.'); return; }
    setError('');
    setSimulating(true);
    await new Promise(r => setTimeout(r, 800));
    const results: SimResult[] = recipients.map(r => {
      const hasEmail = !!r.email;
      const bounce = !hasEmail || Math.random() < 0.12;
      return {
        recipient: r,
        status: bounce ? 'rebotado' : 'enviado',
        detail: bounce
          ? (hasEmail ? 'Rebote: buzón no disponible (simulado)' : 'Rebote: correo no registrado para el propietario')
          : 'Envío exitoso (simulado)',
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
      {/* Template Selector */}
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
                  template === t.id
                    ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
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

      {/* Accounts table with corrected columns */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Cuentas de Cobro a Generar
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
            <p className="text-gray-500">No hay cuentas para facturar. Vuelva al Paso 1 y revise la liquidación.</p>
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
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Propiedad</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3 hidden sm:table-cell">Saldo Anterior</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Cargos del Periodo</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3 hidden md:table-cell">Descuento</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Neto a Pagar</th>
                  <th className="text-center text-xs font-semibold text-gray-600 uppercase px-4 py-3 hidden lg:table-cell">Acuerdo</th>
                  <th className="text-center text-xs font-semibold text-gray-600 uppercase px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {liquidation.map((row) => {
                  const rowId = row.rowId || row.due.id;
                  const unitAgreements = agreements.filter(a => a.unit_id === row.unit.id);
                  const hasAgreement = unitAgreements.length > 0;
                  const isIncumplido = unitAgreements.some(a => a.status === 'incumplido');
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
                        <p className="text-sm font-medium text-gray-900">{row.unit.tower} {row.unit.unit_label}</p>
                        <p className="text-xs text-gray-500">{row.unit.owner_name || ''}</p>
                        <p className="text-xs text-gray-400">Periodo {row.due.period}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-700 hidden sm:table-cell">
                        {row.priorBalance > 0 ? formatCOP(row.priorBalance) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-900">{formatCOP(row.currentCharges)}</td>
                      <td className="px-4 py-3 text-right text-sm text-red-600 hidden md:table-cell">
                        {row.discountAmount > 0 ? `-${formatCOP(row.discountAmount)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">{formatCOP(row.netTotal)}</td>
                      <td className="px-4 py-3 text-center hidden lg:table-cell">
                        {hasAgreement ? (
                          <Badge variant={isIncumplido ? 'red' : 'green'}>
                            {isIncumplido ? 'Incumplido' : 'Vigente'}
                          </Badge>
                        ) : (
                          <Badge variant="gray">Sin acuerdo</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handlePreview(row)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Ver PDF"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => downloadSingle(row)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                            title="Descargar PDF"
                          >
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
              <FileStack className="w-4 h-4" /> Descargar seleccionadas en PDF único
            </Button>
            <Button variant="outline" size="sm" onClick={downloadSelectedIndividual} disabled={selectedCount === 0}>
              <Download className="w-4 h-4" /> Descargar individualmente
            </Button>
          </div>
        )}
      </Card>

      {/* Email Dispatch */}
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
            <Input
              label="Asunto del Correo *"
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Ej: Cuenta de Cobro - Octubre 2026"
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cuerpo del Correo <span className="text-gray-400 font-normal">(máx. 1000 caracteres)</span>
              </label>
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value.slice(0, 1000))}
                rows={5}
                placeholder="Estimado propietario, adjuntamos su cuenta de cobro correspondiente al periodo..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
              />
              <p className={`text-xs mt-1 ${bodyRemaining < 100 ? 'text-yellow-600' : 'text-gray-400'}`}>
                {bodyRemaining} caracteres restantes
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar destinatario por propiedad o correo..."
                  value={recipientSearch}
                  onChange={(e) => setRecipientSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <Select value={recipientFilter} onChange={(e) => setRecipientFilter(e.target.value as typeof recipientFilter)} className="sm:w-52">
              <option value="all">Todos los destinatarios</option>
              <option value="with_email">Con correo registrado</option>
              <option value="without_email">Sin correo registrado</option>
            </Select>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2">Propiedad</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2 hidden sm:table-cell">Propietario</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2">Correo</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-2 hidden md:table-cell">Total</th>
                  <th className="text-center text-xs font-semibold text-gray-600 uppercase px-4 py-2">Enviar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRecipients.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                      No hay destinatarios que coincidan con los filtros.
                    </td>
                  </tr>
                ) : filteredRecipients.map(r => (
                  <tr key={r.rowId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.propertyName}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 hidden sm:table-cell">{r.ownerName}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {r.email || <span className="text-gray-400 italic">No registrado</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-900 hidden md:table-cell">{formatCOP(r.total)}</td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(r.rowId)}
                        onChange={() => toggleSelected(r.rowId)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
            <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700">
              La función "Simular Envío" genera un reporte de prueba con los correos enviados y rebotados
              sin enviar mensajes reales. Marque los destinatarios en la tabla para incluirlos.
            </p>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={handleSimulate} disabled={simulating || selectedCount === 0}>
              {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Simular Envío
            </Button>
            {selectedCount === 0 && <span className="text-sm text-gray-500">Seleccione al menos un destinatario</span>}
          </div>
        </CardBody>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Volver</Button>
        <Button onClick={onComplete}>
          <CheckCircle2 className="w-4 h-4" /> Finalizar Proceso
        </Button>
      </div>

      {/* PDF Preview Modal */}
      <Modal
        open={!!previewRow}
        onClose={() => setPreviewRow(null)}
        title={`Vista previa — ${previewRow?.unit.tower} ${previewRow?.unit.unit_label}`}
        size="lg"
      >
        {previewRow && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge variant="blue">Plantilla: {templateLabels[template]}</Badge>
              <Button size="sm" onClick={openPreviewPdf}>
                <Download className="w-4 h-4" /> Descargar PDF
              </Button>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5 max-h-[60vh] overflow-y-auto">
              <div className="border-b-2 border-blue-600 pb-3 mb-4">
                <p className="text-lg font-bold text-gray-900">{org?.name || 'Organización'}</p>
                <p className="text-xs text-gray-500">{org?.address} · Tel: {org?.phone} · {org?.email}</p>
              </div>
              <p className="text-sm font-semibold text-gray-900 mb-1">CUENTA DE COBRO</p>
              <p className="text-xs text-gray-500 mb-3">Periodo: {billingPeriod} · Formato: {templateLabels[template]}</p>
              <div className="bg-gray-50 rounded-lg p-3 mb-3 text-sm">
                <p><strong>Propiedad:</strong> {previewRow.unit.tower} {previewRow.unit.unit_label}</p>
                <p><strong>Propietario:</strong> {previewRow.unit.owner_name || 'N/A'} · Doc: {previewRow.unit.owner_document || 'N/A'}</p>
                <p><strong>Periodo de la cuota:</strong> {previewRow.due.period} · Vence: {formatShortDate(previewRow.due.due_date)}</p>
              </div>

              {/* Itemized charge lines for all templates */}
              <table className="w-full text-xs mb-3">
                <thead><tr className="bg-gray-100">
                  <th className="text-left p-2">Concepto</th>
                  <th className="text-right p-2">Valor</th>
                </tr></thead>
                <tbody>
                  {previewRow.priorBalance > 0 && (
                    <tr><td className="p-2 border-b border-gray-100">Saldo anterior (periodos vencidos)</td><td className="p-2 border-b border-gray-100 text-right">{formatCOP(previewRow.priorBalance)}</td></tr>
                  )}
                  {previewRow.chargeLines.map((line, idx) => (
                    <tr key={idx}><td className="p-2 border-b border-gray-100">{line.conceptName}</td><td className="p-2 border-b border-gray-100 text-right">{formatCOP(line.amount)}</td></tr>
                  ))}
                  {previewRow.interestAmount > 0 && (
                    <tr><td className="p-2 border-b border-gray-100">Interés de mora ({previewRow.interestRate.toFixed(2)}%)</td><td className="p-2 border-b border-gray-100 text-right">{formatCOP(previewRow.interestAmount)}</td></tr>
                  )}
                  {previewRow.discountAmount > 0 && (
                    <tr className="text-red-600"><td className="p-2 border-b border-gray-100">Descuento por pronto pago</td><td className="p-2 border-b border-gray-100 text-right">-{formatCOP(previewRow.discountAmount)}</td></tr>
                  )}
                  <tr className="font-bold bg-gray-50"><td className="p-2">Saldo neto a pagar</td><td className="p-2 text-right">{formatCOP(previewRow.netTotal)}</td></tr>
                </tbody>
              </table>

              {(() => {
                const unitAgreements = agreements.filter(a => a.unit_id === previewRow.unit.id);
                if (unitAgreements.length === 0) {
                  return <p className="mt-3 text-xs text-gray-500 bg-gray-50 p-2 rounded">Sin acuerdo de pago vigente.</p>;
                }
                return (
                  <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-800">
                    <strong>Notas del acuerdo de pago:</strong>
                    {unitAgreements.map(a => (
                      <p key={a.id}>Acuerdo {a.start_period}–{a.end_period}, cuota {formatCOP(a.monthly_amount)} — {a.status === 'incumplido' ? 'Incumplido' : 'En cumplimiento'}</p>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setPreviewRow(null)}>Cerrar</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Simulation Report Modal */}
      <Modal
        open={simModalOpen}
        onClose={() => setSimModalOpen(false)}
        title="Reporte de Simulación de Envío"
        size="lg"
      >
        {simResults && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-500">Total destinatarios</p>
                <p className="text-xl font-bold text-gray-900">{simResults.length}</p>
              </div>
              <div className="rounded-lg bg-green-50 p-3 text-center">
                <p className="text-xs text-green-600">Enviados</p>
                <p className="text-xl font-bold text-green-700">{sentCount}</p>
              </div>
              <div className="rounded-lg bg-red-50 p-3 text-center">
                <p className="text-xs text-red-600">Rebotados</p>
                <p className="text-xl font-bold text-red-700">{bouncedCount}</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-80 overflow-y-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 sticky top-0">
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2">Propiedad</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2 hidden sm:table-cell">Correo</th>
                    <th className="text-center text-xs font-semibold text-gray-600 uppercase px-4 py-2">Estado</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2 hidden md:table-cell">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {simResults.map((r, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-sm font-medium text-gray-900">{r.recipient.propertyName}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-700 hidden sm:table-cell">{r.recipient.email || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        {r.status === 'enviado' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /> Enviado</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-red-700"><AlertTriangle className="w-3.5 h-3.5" /> Rebotado</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 hidden md:table-cell">{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200">
              <Info className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-700">
                Esta es una simulación. No se enviaron correos reales. Para habilitar el envío real,
                configure un proveedor de correo saliente.
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setSimModalOpen(false)}>Cerrar</Button>
              <Button onClick={() => setSimModalOpen(false)}>
                <Users className="w-4 h-4" /> Continuar
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
