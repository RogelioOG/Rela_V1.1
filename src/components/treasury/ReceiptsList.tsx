import { useCallback, useEffect, useState } from 'react';
import { Loader2, Printer, FileText, AlertTriangle, Ban, Trash2, Edit3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCOP } from '@/lib/format';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { PrintableReceipt, ReceiptPrintView } from './ReceiptPrintView';
import { roundMoney } from '@/components/treasury/receiptAllocation';

interface ReceiptsListProps {
  onEditReceipt?: (receipt: any) => void;
}

export function ReceiptsList({ onEditReceipt }: ReceiptsListProps) {
  const orgContext = useOrg();
  const activeOrg = orgContext?.activeOrg;

  const [receipts, setReceipts] = useState<any[]>([]);
  const [snapshotBalanceMap, setSnapshotBalanceMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<PrintableReceipt | null>(null);
  const [currentRawReceipt, setCurrentRawReceipt] = useState<any>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [error, setError] = useState('');

  const loadReceipts = useCallback(async () => {
    if (!activeOrg?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');

    const { data: receiptsData, error: receiptsErr } = await supabase
      .from('receipts')
      .select(`
        *,
        unit:units(tower, unit_label, owner_name),
        method:payment_methods(name),
        allocations:receipt_allocations(
          id,
          due_id,
          concept_id,
          capital_applied,
          interest_applied,
          discount_applied,
          concept:billing_concepts(name, code),
          due:dues(id, unit_id, period, due_date, balance, amount)
        )
      `)
      .eq('organization_id', activeOrg.id)
      .order('created_at', { ascending: false });

    if (receiptsErr) {
      setError('No se pudieron cargar los recibos de caja registrados.');
      setLoading(false);
      return;
    }

    const { data: invoicesData } = await supabase
      .from('invoices')
      .select('id, unit_id, period, items_snapshot')
      .eq('organization_id', activeOrg.id);

    const nextSnapMap: Record<string, number> = {};
    if (Array.isArray(invoicesData)) {
      invoicesData.forEach((inv: any) => {
        const snapArray = Array.isArray(inv?.items_snapshot) ? inv.items_snapshot : [];
        snapArray.forEach((snap: any) => {
          const cid = String(snap?.conceptId || snap?.concept_id || '');
          if (cid && inv?.unit_id && inv?.period) {
            nextSnapMap[`${inv.unit_id}__${inv.period}__${cid}`] = roundMoney(Number(snap?.amount || 0));
          }
        });
      });
    }

    setSnapshotBalanceMap(nextSnapMap);
    setReceipts(Array.isArray(receiptsData) ? receiptsData : []);
    setLoading(false);
  }, [activeOrg?.id]);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  const filteredReceipts = receipts.filter(r =>
    r.receipt_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.unit?.unit_label?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.unit?.owner_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  function handleOpenPrint(rec: any) {
    setCurrentRawReceipt(rec);
    const isVoided = rec.status === 'anulado';

    const rawAllocs = Array.isArray(rec.allocations) ? rec.allocations : [];

    // Agrupar por due_id + concept_id para no duplicar líneas del mismo concepto en el mismo recibo
    const groupedMap: Record<string, any> = {};

    rawAllocs.forEach((alc: any) => {
      const key = `${String(alc?.due_id || '')}__${String(alc?.concept_id || '')}`;
      const cap = Number(alc?.capital_applied || 0);
      const intr = Number(alc?.interest_applied || 0);
      const disc = Number(alc?.discount_applied || 0);

      if (!groupedMap[key]) {
        const unitIdForSnap = alc?.due?.unit_id || rec?.unit_id || '';
        const periodForSnap = alc?.due?.period || '';
        const conceptIdStr = String(alc?.concept_id || '');
        const snapKey = `${unitIdForSnap}__${periodForSnap}__${conceptIdStr}`;

        const hasSnap = Object.prototype.hasOwnProperty.call(snapshotBalanceMap, snapKey);
        const snapCurrentBalance = hasSnap ? roundMoney(Number(snapshotBalanceMap[snapKey] || 0)) : null;

        groupedMap[key] = {
          period: alc?.due?.period || 'N/A',
          dueDate: alc?.due?.due_date || '',
          conceptName: alc?.concept?.name || 'Concepto',
          conceptCode: alc?.concept?.code || 'CON',
          rawApplied: roundMoney(cap + intr),
          rawDiscount: roundMoney(disc),
          snapCurrentBalance,
        };
      } else {
        groupedMap[key].rawApplied = roundMoney(groupedMap[key].rawApplied + cap + intr);
        groupedMap[key].rawDiscount = roundMoney(groupedMap[key].rawDiscount + disc);
      }
    });

    const lines = Object.values(groupedMap)
      .map((entry: any) => {
        const applied = isVoided ? 0 : entry.rawApplied;
        const discount = isVoided ? 0 : entry.rawDiscount;

        // Si tenemos el saldo del concepto en items_snapshot, usamos ese saldo específico;
        // si no, usamos lo aplicado/descontado del concepto sin inflar con el saldo total de toda la cuota.
        const balanceAfter =
          entry.snapCurrentBalance !== null
            ? isVoided
              ? roundMoney(Math.max(entry.snapCurrentBalance + entry.rawApplied + entry.rawDiscount, 0))
              : roundMoney(Math.max(entry.snapCurrentBalance, 0))
            : 0;

        const initialBalance = isVoided
          ? balanceAfter
          : roundMoney(balanceAfter + applied + discount);

        return {
          period: entry.period,
          dueDate: entry.dueDate,
          conceptName: entry.conceptName,
          conceptCode: entry.conceptCode,
          initialBalance,
          discount,
          applied,
          balanceAfter,
        };
      })
      .filter(l => l.applied > 0 || l.discount > 0);

    const totalVal = isVoided ? 0 : roundMoney(Number(rec.total_amount || 0));
    const advanceVal = isVoided ? 0 : roundMoney(Number(rec.advance_amount || 0));
    const appliedVal = isVoided ? 0 : roundMoney(lines.reduce((acc, l) => acc + l.applied, 0));

    setSelectedReceipt({
      receiptNumber: rec.receipt_number,
      status: rec.status,
      organizationName: activeOrg?.name || '',
      organizationNit: activeOrg?.nit || '',
      unitLabel: rec.unit?.tower ? `Torre ${rec.unit.tower} · ${rec.unit.unit_label}` : (rec.unit?.unit_label || ''),
      ownerName: rec.unit?.owner_name || '',
      paymentDate: rec.payment_date,
      accountingDate: rec.accounting_date,
      methodName: rec.method?.name || 'Efectivo / Consignación',
      total: totalVal,
      applied: appliedVal,
      advance: advanceVal,
      notes: isVoided
        ? `DOCUMENTO ANULADO${rec.notes ? ` — ${rec.notes}` : ''}`
        : rec.notes,
      lines,
    });
    setPrintOpen(true);
  }

  async function handleVoidReceipt(receiptId: string) {
    if (!activeOrg) return;
    if (!window.confirm('¿Está seguro de anular este recibo? Se revertirá la cartera, quedará en $ 0 y se actualizará el asiento contable.')) return;

    setActionLoading(receiptId);
    const { data, error: rpcErr } = await supabase.rpc('void_receipt', {
      p_receipt_id: receiptId,
      p_organization_id: activeOrg.id,
    });
    setActionLoading(null);

    if (rpcErr || (data && data.success === false)) {
      alert(rpcErr?.message || data?.message || 'Error al anular el recibo.');
      return;
    }

    setPrintOpen(false);
    await loadReceipts();
  }

  async function handleDeleteReceipt(receiptId: string) {
    if (!activeOrg) return;
    if (!window.confirm('¿Está seguro de ELIMINAR definitivamente este recibo de la base de datos? Se revertirá la cartera y el asiento contable.')) return;

    setActionLoading(receiptId);

    try {
      const { data, error: rpcErr } = await supabase.rpc('delete_receipt', {
        p_receipt_id: receiptId,
        p_organization_id: activeOrg.id,
      });

      setActionLoading(null);

      if (rpcErr) {
        alert('Error de base de datos: ' + rpcErr.message);
        return;
      }

      if (data && data.success === false) {
        alert(data?.message || 'No se pudo completar la eliminación del recibo.');
        return;
      }

      setPrintOpen(false);
      await loadReceipts();
    } catch (err: any) {
      setActionLoading(null);
      alert('Ocurrió un error inesperado: ' + (err?.message || err));
    }
  }

  function handleEdit(rec: any) {
    if (!activeOrg) return;
    if (!window.confirm(`¿Desea editar el recibo ${rec.receipt_number}? Se cargarán los datos en el formulario para su modificación.`)) return;

    setPrintOpen(false);
    if (onEditReceipt) {
      onEditReceipt(rec);
    }
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="space-y-6">
      <Card>
        <div className="p-6 flex flex-wrap items-center justify-between gap-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Historial de Recaudos (Recibos de Caja)</h2>
            <p className="text-sm text-gray-500">Consulte, reimprima, edite, anule o elimine los comprobantes de pago emitidos.</p>
          </div>
          <div className="w-full sm:w-72">
            <Input
              placeholder="Buscar por No. recibo, unidad o propietario..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          </div>
        ) : error ? (
          <div className="p-6">
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        ) : filteredReceipts.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <FileText className="w-10 h-10 mx-auto text-gray-300 mb-2" />
            <p>No se encontraron recibos de caja registrados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Recibo No.</th>
                  <th className="px-4 py-3">Fecha Pago</th>
                  <th className="px-4 py-3">Unidad</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Valor Total</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredReceipts.map(rec => {
                  const isVoided = rec.status === 'anulado';
                  const isProcessing = actionLoading === rec.id;
                  const displayAmount = isVoided ? 0 : Number(rec.total_amount || 0);

                  return (
                    <tr key={rec.id} className={`hover:bg-gray-50 ${isVoided ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-4 font-mono font-bold text-blue-700">
                        <div className="flex items-center gap-2">
                          <span>{rec.receipt_number}</span>
                          {isVoided && (
                            <span className="text-[11px] font-sans font-normal text-red-700">(Documento anulado)</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-gray-600">{rec.payment_date}</td>
                      <td className="px-4 py-4 font-medium text-gray-900">
                        {rec.unit?.tower ? `Torre ${rec.unit.tower} · ${rec.unit.unit_label}` : rec.unit?.unit_label}
                      </td>
                      <td className="px-4 py-4">
                        {isVoided ? (
                          <span className="px-2 py-0.5 text-xs font-semibold rounded bg-red-100 text-red-800">ANULADO</span>
                        ) : (
                          <span className="px-2 py-0.5 text-xs font-semibold rounded bg-green-100 text-green-800">ACTIVO</span>
                        )}
                      </td>
                      <td className={`px-4 py-4 text-right font-semibold ${isVoided ? 'text-red-700' : 'text-gray-900'}`}>
                        {formatCOP(displayAmount)}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button type="button" variant="outline" size="sm" onClick={() => handleOpenPrint(rec)}>
                            <Printer className="w-3.5 h-3.5 mr-1" /> Imprimir
                          </Button>

                          {!isVoided && (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-blue-700 border-blue-300 hover:bg-blue-50"
                                disabled={isProcessing}
                                onClick={() => handleEdit(rec)}
                              >
                                {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Edit3 className="w-3.5 h-3.5 mr-1" />} Editar
                              </Button>

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-amber-700 border-amber-300 hover:bg-amber-50"
                                disabled={isProcessing}
                                onClick={() => handleVoidReceipt(rec.id)}
                              >
                                <Ban className="w-3.5 h-3.5 mr-1" /> Anular
                              </Button>

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-red-700 border-red-300 hover:bg-red-50"
                                disabled={isProcessing}
                                onClick={() => handleDeleteReceipt(rec.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
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

      <Modal open={printOpen} onClose={() => setPrintOpen(false)} title="Detalle de Recibo de Caja" size="lg">
        {selectedReceipt && <ReceiptPrintView receipt={selectedReceipt} />}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-gray-200 mt-4">
          <div className="flex items-center gap-2">
            {currentRawReceipt && currentRawReceipt.status !== 'anulado' && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="text-blue-700 border-blue-300 hover:bg-blue-50"
                  onClick={() => handleEdit(currentRawReceipt)}
                >
                  <Edit3 className="w-4 h-4 mr-1" /> Editar Recibo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="text-amber-700 border-amber-300 hover:bg-amber-50"
                  onClick={() => handleVoidReceipt(currentRawReceipt.id)}
                >
                  <Ban className="w-4 h-4 mr-1" /> Anular Recibo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="text-red-700 border-red-300 hover:bg-red-50"
                  onClick={() => handleDeleteReceipt(currentRawReceipt.id)}
                >
                  <Trash2 className="w-4 h-4 mr-1" /> Eliminar
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setPrintOpen(false)}>Cerrar</Button>
            <Button type="button" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" /> Imprimir o guardar PDF</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}