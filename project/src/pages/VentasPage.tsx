import { useEffect, useState } from 'react';
import { Receipt, Search, Loader2, Printer, Eye, Ban, AlertTriangle, Calendar } from 'lucide-react';
import { supabase, Invoice, InvoiceItem, ThirdParty } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, formatShortDate, formatDateTime, paymentMethodLabels, invoiceStatusLabels } from '@/lib/format';

export default function VentasPage() {
  const { activeOrg, isOrgAdmin } = useOrg();
  const { profile } = useAuth();
  const [invoices, setInvoices] = useState<(Invoice & { third_parties?: ThirdParty })[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [detailInvoice, setDetailInvoice] = useState<(Invoice & { invoice_items?: InvoiceItem[]; third_parties?: ThirdParty }) | null>(null);
  const [cancelTarget, setCancelTarget] = useState<(Invoice & { third_parties?: ThirdParty }) | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const canCancel = isOrgAdmin || profile?.role === 'master';

  useEffect(() => { if (activeOrg) loadData(); }, [activeOrg]);

  async function loadData() {
    if (!activeOrg) return;
    setLoading(true);
    let query = supabase
      .from('invoices')
      .select('*, third_parties(*)')
      .eq('organization_id', activeOrg.id)
      .order('created_at', { ascending: false });

    if (dateFrom) query = query.gte('date', dateFrom);
    if (dateTo) query = query.lte('date', dateTo);

    const { data } = await query;
    setInvoices(data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (activeOrg) loadData();
  }, [dateFrom, dateTo]);

  const filtered = invoices.filter(inv => {
    const ms = !search || inv.number.toLowerCase().includes(search.toLowerCase()) ||
      (inv.third_parties?.name || '').toLowerCase().includes(search.toLowerCase());
    const mf = !filterStatus || inv.status === filterStatus;
    return ms && mf;
  });

  async function openDetail(inv: Invoice & { third_parties?: ThirdParty }) {
    const { data: items } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', inv.id);
    setDetailInvoice({ ...inv, invoice_items: items || [] });
  }

  async function handleCancel() {
    if (!cancelTarget || !activeOrg) return;
    setCancelling(true); setCancelError('');
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id || null;

    const { error: err } = await supabase
      .from('invoices')
      .update({
        status: 'anulada',
        cancelled_at: new Date().toISOString(),
        cancelled_reason: cancelReason || 'Anulada por usuario',
        cancelled_by: userId,
      })
      .eq('id', cancelTarget.id);

    if (err) { setCancelError(err.message); setCancelling(false); return; }

    setCancelling(false);
    setCancelTarget(null);
    setCancelReason('');
    await loadData();
  }

  function printInvoice() {
    window.print();
  }

  function clearDateFilters() {
    setDateFrom('');
    setDateTo('');
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Historial de Ventas</h1>
        <p className="text-gray-500 mt-1">Consulte el detalle de cada factura registrada</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar por número o cliente..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos los estados</option>
          <option value="pagada">Pagadas</option>
          <option value="credito">A Crédito</option>
          <option value="anulada">Anuladas</option>
        </select>
      </div>

      {/* Date Range Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-5 p-3 rounded-lg bg-gray-50 border border-gray-200">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="font-medium">Rango de fechas:</span>
        </div>
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500">Desde</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500">Hasta</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {(dateFrom || dateTo) && (
            <button onClick={clearDateFilters} className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1">
              Limpiar
            </button>
          )}
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Receipt className="w-8 h-8 text-gray-400" /></div>
            <p className="text-gray-500">No se encontraron ventas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Factura</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Fecha</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Cliente</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Pago</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Total</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(inv => (
                  <tr key={inv.id} className={`hover:bg-gray-50 ${inv.status === 'anulada' ? 'opacity-60' : ''}`}>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {inv.number}
                      {inv.status === 'anulada' && inv.cancelled_reason && (
                        <p className="text-xs text-red-500 mt-0.5">Motivo: {inv.cancelled_reason}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden md:table-cell">{formatShortDate(inv.date)}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{inv.third_parties?.name || 'Cliente Mostrador'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden lg:table-cell">
                      {paymentMethodLabels[inv.payment_method]}
                      {inv.credit_term_days && <span className="text-xs text-gray-400 block">{inv.credit_term_days} días</span>}
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={inv.status === 'pagada' ? 'green' : inv.status === 'credito' ? 'yellow' : 'red'}>
                        {invoiceStatusLabels[inv.status]}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                      {inv.status === 'anulada' ? <span className="line-through text-gray-400">{formatCOP(inv.total)}</span> : formatCOP(inv.total)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openDetail(inv)} className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600" title="Ver detalle">
                          <Eye className="w-4 h-4" />
                        </button>
                        {canCancel && inv.status !== 'anulada' && (
                          <button onClick={() => { setCancelTarget(inv); setCancelReason(''); setCancelError(''); }} className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600" title="Anular factura">
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Invoice Detail Modal */}
      <Modal open={!!detailInvoice} onClose={() => setDetailInvoice(null)} title="Detalle de Factura" size="md">
        {detailInvoice && (
          <div className="space-y-4">
            <div className="text-center pb-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">{activeOrg.name}</h2>
              <p className="text-sm text-gray-500">{activeOrg.address} · {activeOrg.phone}</p>
              <p className="text-sm text-gray-500">NIT: {activeOrg.nit || 'N/A'}</p>
            </div>
            <div className="flex justify-between text-sm">
              <div>
                <p className="font-semibold text-gray-900">{detailInvoice.number}</p>
                <p className="text-gray-500">Fecha: {formatShortDate(detailInvoice.date)}</p>
                <p className="text-gray-500">Registrada: {formatDateTime(detailInvoice.created_at)}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-500">Cliente: {detailInvoice.third_parties?.name || 'Cliente Mostrador'}</p>
                <p className="text-gray-500">Pago: {paymentMethodLabels[detailInvoice.payment_method]}</p>
                {detailInvoice.credit_term_days && <p className="text-gray-500">Plazo: {detailInvoice.credit_term_days} días</p>}
                <div className="mt-1"><Badge variant={detailInvoice.status === 'pagada' ? 'green' : detailInvoice.status === 'credito' ? 'yellow' : 'red'}>{invoiceStatusLabels[detailInvoice.status]}</Badge></div>
              </div>
            </div>
            {detailInvoice.status === 'anulada' && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <Ban className="w-4 h-4 text-red-600" />
                  <p className="text-sm font-medium text-red-700">Factura Anulada</p>
                </div>
                {detailInvoice.cancelled_at && <p className="text-xs text-red-600">Anulada el: {formatDateTime(detailInvoice.cancelled_at)}</p>}
                {detailInvoice.cancelled_reason && <p className="text-xs text-red-600">Motivo: {detailInvoice.cancelled_reason}</p>}
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="text-left py-1">Producto</th>
                  <th className="text-right py-1">Cant.</th>
                  <th className="text-right py-1">Precio</th>
                  <th className="text-right py-1 hidden sm:table-cell">Desc.</th>
                  <th className="text-right py-1 hidden sm:table-cell">Imp.</th>
                  <th className="text-right py-1">Total</th>
                </tr>
              </thead>
              <tbody>
                {(detailInvoice.invoice_items || []).map(item => (
                  <tr key={item.id} className="border-b border-gray-50">
                    <td className="py-1 text-gray-700">{item.description}</td>
                    <td className="py-1 text-right text-gray-700">{item.quantity}</td>
                    <td className="py-1 text-right text-gray-700">{formatCOP(item.unit_price)}</td>
                    <td className="py-1 text-right text-green-600 hidden sm:table-cell">{item.discount_amount > 0 ? `-${formatCOP(item.discount_amount)}` : '-'}</td>
                    <td className="py-1 text-right text-gray-700 hidden sm:table-cell">{item.tax_amount > 0 ? formatCOP(item.tax_amount) : '-'}</td>
                    <td className="py-1 text-right text-gray-900 font-medium">{formatCOP(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="space-y-1 pt-2 border-t border-gray-200">
              <div className="flex justify-between text-sm"><span className="text-gray-600">Subtotal:</span><span>{formatCOP(detailInvoice.subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-600">Impuestos:</span><span>{formatCOP(detailInvoice.tax)}</span></div>
              <div className="flex justify-between text-base font-bold"><span>Total:</span><span className="text-blue-600">{formatCOP(detailInvoice.total)}</span></div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setDetailInvoice(null)}>Cerrar</Button>
              <Button onClick={printInvoice}><Printer className="w-4 h-4" /> Imprimir</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cancellation Modal */}
      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Anular Factura" size="sm">
        {cancelTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-700">¿Anular la factura {cancelTarget.number}?</p>
                <p className="text-xs text-red-600 mt-1">
                  Esta acción genera una nota crédito (NC) que revierte el asiento contable y restaura el inventario. No se puede deshacer.
                </p>
              </div>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-600">Factura:</span><span className="font-medium">{cancelTarget.number}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Cliente:</span><span className="font-medium">{cancelTarget.third_parties?.name || 'Cliente Mostrador'}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Total:</span><span className="font-medium">{formatCOP(cancelTarget.total)}</span></div>
            </div>
            <Input
              label="Motivo de anulación"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Ej: Error en facturación, devolución del cliente..."
            />
            {cancelError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{cancelError}</p></div>}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setCancelTarget(null)}>Cancelar</Button>
              <Button variant="danger" onClick={handleCancel} disabled={cancelling}>
                {cancelling ? <><Loader2 className="w-4 h-4 animate-spin" /> Anulando...</> : <><Ban className="w-4 h-4" /> Sí, Anular</>}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
