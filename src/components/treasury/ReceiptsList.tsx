import { useCallback, useEffect, useState } from 'react';
import { Loader2, Printer, Search, FileText, AlertTriangle, Ban, Trash2, Edit3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCOP } from '@/lib/format';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { PrintableReceipt, ReceiptPrintView } from './ReceiptPrintView';
import { Badge } from '@/components/ui/Badge';

interface ReceiptsListProps {
  onEditReceipt?: (receipt: any) => void;
}

export function ReceiptsList({ onEditReceipt }: ReceiptsListProps) {
  const { activeOrg } = useOrg();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<PrintableReceipt | null>(null);
  const [currentRawReceipt, setCurrentRawReceipt] = useState<any>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [error, setError] = useState('');

  const loadReceipts = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    setError('');

    const { data, error } = await supabase
      .from('receipts')
      .select(`
        *,
        unit:units(tower, unit_label, owner_name),
        method:payment_methods(name),
        allocations:receipt_allocations(
          due_id,
          capital_applied,
          interest_applied,
          concept:billing_concepts(name, code),
          due:dues(period, due_date)
        )
      `)
      .eq('organization_id', activeOrg.id)
      .order('created_at', { ascending: false });

    if (error) {
      setError('No se pudieron cargar los recibos de caja registrados.');
      setLoading(false);
      return;
    }

    setReceipts(data || []);
    setLoading(false);
  }, [activeOrg]);

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
    const lines = (rec.allocations || []).map((alc: any) => ({
      period: alc.due?.period || 'N/A',
      dueDate: alc.due?.due_date || '',
      conceptName: alc.concept?.name || 'Concepto',
      conceptCode: alc.concept?.code || 'CON',
      initialBalance: (alc.capital_applied || 0) + (alc.interest_applied || 0),
      discount: 0,
      applied: (alc.capital_applied || 0) + (alc.interest_applied || 0),
      balanceAfter: 0,
    }));

    setSelectedReceipt({
      receiptNumber: rec.receipt_number,
      organizationName: activeOrg?.name || '',
      organizationNit: activeOrg?.nit || '',
      unitLabel: rec.unit?.tower ? `Torre ${rec.unit.tower} · ${rec.unit.unit_label}` : (rec.unit?.unit_label || ''),
      ownerName: rec.unit?.owner_name || '',
      paymentDate: rec.payment_date,
      accountingDate: rec.accounting_date,
      methodName: rec.method?.name || 'Efectivo / Consignación',
      total: Number(rec.total_amount || 0),
      applied: Number(rec.total_amount || 0) - Number(rec.advance_amount || 0),
      advance: Number(rec.advance_amount || 0),
      notes: rec.notes,
      lines,
    });
    setPrintOpen(true);
  }

  async function handleVoidReceipt(receiptId: string) {
    if (!activeOrg) return;
    if (!window.confirm('¿Está seguro de anular este recibo? Se revertirá la cartera y la afectación contable.')) return;

    setActionLoading(receiptId);
    const { data, error } = await supabase.rpc('void_receipt', {
      p_receipt_id: receiptId,
      p_organization_id: activeOrg.id,
    });
    setActionLoading(null);

    if (error || !data?.success) {
      alert(error?.message || data?.message || 'Error al anular el recibo.');
      return;
    }

    setPrintOpen(false);
    await loadReceipts();
  }

  async function handleDeleteReceipt(receiptId: string) {
    if (!activeOrg) return;
    if (!window.confirm('¿Está seguro de ELIMINAR definitivamente este recibo de la base de datos?')) return;

    setActionLoading(receiptId);
    // 1. Revertir saldos primero
    await supabase.rpc('void_receipt', { p_receipt_id: receiptId, p_organization_id: activeOrg.id });
    // 2. Eliminar asignaciones y recibo
    await supabase.from('receipt_allocations').delete().eq('receipt_id', receiptId);
    const { error } = await supabase.from('receipts').delete().eq('id', receiptId);
    setActionLoading(null);

    if (error) {
      alert('Error al eliminar el recibo: ' + error.message);
      return;
    }

    setPrintOpen(false);
    await loadReceipts();
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="space-y-6">
      <Card>
        <div className="p-6 flex flex-wrap items-center justify-between gap-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Historial de Recaudos (Recibos de Caja)</h2>
            <p className="text-sm text-gray-500">Consulte, reimprima, anule o elimine los comprobantes de pago emitidos.</p>
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

                  return (
                    <tr key={rec.id} className={`hover:bg-gray-50 ${isVoided ? 'bg-red-50/40 opacity-75' : ''}`}>
                      <td className="px-4 py-4 font-mono font-bold text-blue-700">{rec.receipt_number}</td>
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
                      <td className="px-4 py-4 text-right font-semibold text-gray-900">{formatCOP(rec.total_amount)}</td>
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
                                className="text-amber-700 border-amber-300 hover:bg-amber-50"
                                disabled={isProcessing}
                                onClick={() => handleVoidReceipt(rec.id)}
                              >
                                {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5 mr-1" />} Anular
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