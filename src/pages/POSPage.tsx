import { useEffect, useState } from 'react';
import { ShoppingCart, Search, Plus, Minus, Trash2, Loader2, Printer, AlertCircle, Tag } from 'lucide-react';
import { supabase, Product, ThirdParty, Invoice, InvoiceItem } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, formatShortDate, paymentMethodLabels } from '@/lib/format';

interface CartItem {
  product: Product;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRate: number;
  taxName: string;
}

function isDiscountActive(p: Product): boolean {
  if (!p.discount_enabled) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (p.discount_start_date && today < p.discount_start_date) return false;
  if (p.discount_end_date && today > p.discount_end_date) return false;
  return true;
}

function computeDiscount(p: Product): number {
  if (!isDiscountActive(p)) return 0;
  if (p.discount_type === 'porcentaje') {
    return Math.round(p.sale_price * p.discount_value / 100);
  }
  return Math.min(p.discount_value, p.sale_price);
}

export default function POSPage() {
  const { activeOrg } = useOrg();
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<ThirdParty[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [clientId, setClientId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
  const [creditTermDays, setCreditTermDays] = useState('30');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [recentInvoices, setRecentInvoices] = useState<Invoice[]>([]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewInvoice, setPreviewInvoice] = useState<(Invoice & { invoice_items?: InvoiceItem[]; third_parties?: ThirdParty }) | null>(null);

  useEffect(() => { if (activeOrg) loadData(); }, [activeOrg]);

  async function loadData() {
    if (!activeOrg) return;
    const [{ data: prods }, { data: clientsData }, { data: invoices }] = await Promise.all([
      supabase.from('products').select('*').eq('organization_id', activeOrg.id).eq('is_active', true).order('name'),
      supabase.from('third_parties').select('*').eq('organization_id', activeOrg.id).eq('type', 'cliente').eq('is_active', true).order('name'),
      supabase.from('invoices').select('*').eq('organization_id', activeOrg.id).order('created_at', { ascending: false }).limit(5),
    ]);
    setProducts(prods || []);
    setClients(clientsData || []);
    setRecentInvoices(invoices || []);
  }

  const filteredProducts = products.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.includes(search));

  function addToCart(product: Product) {
    const discount = computeDiscount(product);
    const unitPrice = product.sale_price - discount;
    const taxRate = product.tax_enabled ? product.tax_rate : 0;
    const taxName = product.tax_enabled ? product.tax_name : '';
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product, quantity: 1, unitPrice, discountAmount: discount, taxRate, taxName }];
    });
  }

  function updateQty(productId: string, delta: number) {
    setCart(prev => prev.map(i => i.product.id === productId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i).filter(i => i.quantity > 0));
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev.filter(i => i.product.id !== productId));
  }

  const subtotal = cart.reduce((sum, i) => sum + i.product.sale_price * i.quantity, 0);
  const totalDiscount = cart.reduce((sum, i) => sum + i.discountAmount * i.quantity, 0);
  const taxableBase = cart.reduce((sum, i) => sum + (i.unitPrice * i.quantity), 0);
  const totalTax = cart.reduce((sum, i) => {
    const lineBase = i.unitPrice * i.quantity;
    return sum + Math.round(lineBase * i.taxRate / 100);
  }, 0);
  const total = taxableBase + totalTax;

  const isCredit = paymentMethod === 'credito';
  const needsClient = isCredit;

  function openConfirm() {
    setError('');
    if (cart.length === 0) return;
    if (needsClient && !clientId) { setError('Seleccione un cliente para ventas a crédito'); return; }
    if (isCredit && (!creditTermDays || parseInt(creditTermDays) <= 0)) { setError('Especifique el plazo en días para ventas a crédito'); return; }
    setConfirmOpen(true);
  }

  async function handleCheckout() {
    if (!activeOrg || cart.length === 0) return;
    setConfirmOpen(false);
    setSaving(true); setError('');
    const { count } = await supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('organization_id', activeOrg.id);
    const invoiceNumber = `F-${String((count || 0) + 1).padStart(5, '0')}`;
    const status = paymentMethod === 'credito' ? 'credito' : 'pagada';
    const creditDays = isCredit ? parseInt(creditTermDays) || 30 : null;

    const { data: invoice, error: invError } = await supabase.from('invoices').insert({
      organization_id: activeOrg.id, number: invoiceNumber,
      third_party_id: clientId || null, date: new Date().toISOString().slice(0, 10),
      subtotal: subtotal - totalDiscount, tax: totalTax, total, payment_method: paymentMethod, status,
      credit_term_days: creditDays,
    }).select().single();

    if (invError || !invoice) { setError(invError?.message || 'Error al crear factura'); setSaving(false); return; }

    const items = cart.map(i => {
      const lineBase = i.unitPrice * i.quantity;
      const lineTax = Math.round(lineBase * i.taxRate / 100);
      const lineDiscount = i.discountAmount * i.quantity;
      return {
        invoice_id: invoice.id, product_id: i.product.id, description: i.product.name,
        quantity: i.quantity, unit_price: i.product.sale_price,
        line_total: lineBase,
        tax_rate: i.taxRate,
        tax_amount: lineTax,
        discount_amount: lineDiscount,
      };
    });
    const { error: itemsError } = await supabase.from('invoice_items').insert(items);
    if (itemsError) { setError(itemsError.message); setSaving(false); return; }

    for (const item of cart) {
      await supabase.from('products').update({ stock: item.product.stock - item.quantity }).eq('id', item.product.id);
    }

    const { data: fullInvoice } = await supabase
      .from('invoices')
      .select('*, invoice_items(*), third_parties(*)')
      .eq('id', invoice.id)
      .single();

    setSaving(false); setCart([]); setClientId(''); setPaymentMethod('efectivo'); setCreditTermDays('30');
    setPreviewInvoice(fullInvoice as any);
    await loadData();
  }

  function printInvoice() {
    window.print();
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Punto de Venta</h1>
        <p className="text-gray-500 mt-1">Registro rápido de ventas</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product selection */}
        <div className="lg:col-span-2">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Buscar producto..." value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-300 pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[600px] overflow-y-auto">
            {filteredProducts.map(p => {
              const discActive = isDiscountActive(p);
              const discount = computeDiscount(p);
              const finalPrice = p.sale_price - discount;
              return (
                <button key={p.id} onClick={() => addToCart(p)}
                  className="flex flex-col items-start p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left">
                  <p className="text-sm font-medium text-gray-900 truncate w-full">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.sku || 'N/A'}</p>
                  {discActive && discount > 0 ? (
                    <div className="mt-1 w-full">
                      <p className="text-xs text-gray-400 line-through">{formatCOP(p.sale_price)}</p>
                      <p className="text-sm font-bold text-green-600">{formatCOP(finalPrice)}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Tag className="w-3 h-3 text-green-500" />
                        <span className="text-xs text-green-600">
                          {p.discount_type === 'porcentaje' ? `-${p.discount_value}%` : `-${formatCOP(discount)}`}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm font-bold text-blue-600 mt-1">{formatCOP(p.sale_price)}</p>
                  )}
                  {p.tax_enabled && (
                    <p className="text-xs text-gray-400 mt-0.5">{p.tax_name} {p.tax_rate}%</p>
                  )}
                  <p className="text-xs text-gray-400">Stock: {p.stock}</p>
                </button>
              );
            })}
            {filteredProducts.length === 0 && <p className="text-gray-400 text-sm col-span-full text-center py-8">No hay productos</p>}
          </div>
        </div>

        {/* Cart */}
        <div>
          <Card className="sticky top-20">
            <CardBody>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Carrito de Venta</h3>
              {cart.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Agregue productos al carrito</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {cart.map(item => (
                    <div key={item.product.id} className="flex items-center gap-2 py-2 border-b border-gray-100">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.product.name}</p>
                        <p className="text-xs text-gray-500">
                          {formatCOP(item.unitPrice)} c/u
                          {item.discountAmount > 0 && <span className="text-green-600"> (desc: -{formatCOP(item.discountAmount)})</span>}
                        </p>
                        {item.taxRate > 0 && <p className="text-xs text-gray-400">{item.taxName} {item.taxRate}%</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateQty(item.product.id, -1)} className="p-1 rounded hover:bg-gray-100"><Minus className="w-3 h-3" /></button>
                        <span className="text-sm w-8 text-center">{item.quantity}</span>
                        <button onClick={() => updateQty(item.product.id, 1)} className="p-1 rounded hover:bg-gray-100"><Plus className="w-3 h-3" /></button>
                        <button onClick={() => removeFromCart(item.product.id)} className="p-1 rounded text-red-400 hover:bg-red-50"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {cart.length > 0 && (
                <div className="mt-4 space-y-3">
                  <div className="flex justify-between text-sm"><span className="text-gray-600">Subtotal:</span><span className="font-medium">{formatCOP(subtotal)}</span></div>
                  {totalDiscount > 0 && (
                    <div className="flex justify-between text-sm"><span className="text-gray-600">Descuentos:</span><span className="font-medium text-green-600">-{formatCOP(totalDiscount)}</span></div>
                  )}
                  {totalTax > 0 && (
                    <div className="flex justify-between text-sm"><span className="text-gray-600">Impuestos:</span><span className="font-medium">{formatCOP(totalTax)}</span></div>
                  )}
                  <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2"><span>Total:</span><span className="text-blue-600">{formatCOP(total)}</span></div>
                  <Select label="Cliente" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    <option value="">Cliente mostrador</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                  <Select label="Medio de Pago" value={paymentMethod} onChange={(e) => { setPaymentMethod(e.target.value); if (e.target.value !== 'credito') setError(''); }}>
                    {Object.entries(paymentMethodLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                  {isCredit && (
                    <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-yellow-600" />
                        <p className="text-xs font-medium text-yellow-800">Venta a Crédito (Fiado)</p>
                      </div>
                      <Input label="Plazo en días *" type="number" value={creditTermDays}
                        onChange={(e) => setCreditTermDays(e.target.value)} required min="1" placeholder="Ej: 30" />
                      {needsClient && !clientId && <p className="text-xs text-red-600">Seleccione un cliente</p>}
                    </div>
                  )}
                  {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2"><p className="text-xs text-red-700">{error}</p></div>}
                  <Button onClick={openConfirm} disabled={saving} className="w-full" size="lg">
                    {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Procesando...</> : 'Registrar Venta'}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          {recentInvoices.length > 0 && (
            <Card className="mt-4">
              <CardBody>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Ventas Recientes</h3>
                <div className="space-y-2">
                  {recentInvoices.map(inv => (
                    <div key={inv.id} className="flex justify-between text-sm">
                      <span className="text-gray-700">{inv.number}</span>
                      <span className="font-medium">{formatCOP(inv.total)}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirmar Venta" size="sm">
        <div className="space-y-4">
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 space-y-2">
            <div className="flex justify-between text-sm"><span className="text-gray-600">Productos:</span><span className="font-medium">{cart.length} artículo(s)</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Subtotal:</span><span className="font-medium">{formatCOP(subtotal)}</span></div>
            {totalDiscount > 0 && (
              <div className="flex justify-between text-sm"><span className="text-gray-600">Descuentos:</span><span className="font-medium text-green-600">-{formatCOP(totalDiscount)}</span></div>
            )}
            {totalTax > 0 && (
              <div className="flex justify-between text-sm"><span className="text-gray-600">Impuestos:</span><span className="font-medium">{formatCOP(totalTax)}</span></div>
            )}
            <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2"><span>Total:</span><span className="text-blue-600">{formatCOP(total)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Medio de Pago:</span><span className="font-medium">{paymentMethodLabels[paymentMethod]}</span></div>
            {isCredit && (
              <div className="flex justify-between text-sm"><span className="text-gray-600">Plazo:</span><span className="font-medium">{creditTermDays} días</span></div>
            )}
            {clientId && (
              <div className="flex justify-between text-sm"><span className="text-gray-600">Cliente:</span><span className="font-medium">{clients.find(c => c.id === clientId)?.name || 'N/A'}</span></div>
            )}
          </div>
          <p className="text-sm text-gray-500">¿Confirma el registro de esta venta?</p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button onClick={handleCheckout} disabled={saving}>{saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Procesando...</> : 'Confirmar Venta'}</Button>
          </div>
        </div>
      </Modal>

      {/* Invoice Preview Modal */}
      <Modal open={!!previewInvoice} onClose={() => setPreviewInvoice(null)} title="Factura Generada" size="md">
        {previewInvoice && (
          <div className="space-y-4">
            <div className="text-center pb-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">{activeOrg.name}</h2>
              <p className="text-sm text-gray-500">{activeOrg.address} · {activeOrg.phone}</p>
              <p className="text-sm text-gray-500">NIT: {activeOrg.nit || 'N/A'}</p>
            </div>
            <div className="flex justify-between text-sm">
              <div>
                <p className="font-semibold text-gray-900">{previewInvoice.number}</p>
                <p className="text-gray-500">Fecha: {formatShortDate(previewInvoice.date)}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-500">Cliente: {previewInvoice.third_parties?.name || 'Cliente Mostrador'}</p>
                <p className="text-gray-500">Pago: {paymentMethodLabels[previewInvoice.payment_method]}</p>
                {previewInvoice.credit_term_days && <p className="text-gray-500">Plazo: {previewInvoice.credit_term_days} días</p>}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="text-left py-1">Producto</th>
                  <th className="text-right py-1">Cant.</th>
                  <th className="text-right py-1">Precio</th>
                  <th className="text-right py-1">Desc.</th>
                  <th className="text-right py-1">Imp.</th>
                  <th className="text-right py-1">Total</th>
                </tr>
              </thead>
              <tbody>
                {(previewInvoice.invoice_items || []).map(item => (
                  <tr key={item.id} className="border-b border-gray-50">
                    <td className="py-1 text-gray-700">{item.description}</td>
                    <td className="py-1 text-right text-gray-700">{item.quantity}</td>
                    <td className="py-1 text-right text-gray-700">{formatCOP(item.unit_price)}</td>
                    <td className="py-1 text-right text-green-600">{item.discount_amount > 0 ? `-${formatCOP(item.discount_amount)}` : '-'}</td>
                    <td className="py-1 text-right text-gray-700">{item.tax_amount > 0 ? formatCOP(item.tax_amount) : '-'}</td>
                    <td className="py-1 text-right text-gray-900 font-medium">{formatCOP(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="space-y-1 pt-2 border-t border-gray-200">
              <div className="flex justify-between text-sm"><span className="text-gray-600">Subtotal:</span><span>{formatCOP(previewInvoice.subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-600">Impuestos:</span><span>{formatCOP(previewInvoice.tax)}</span></div>
              <div className="flex justify-between text-base font-bold"><span>Total:</span><span className="text-blue-600">{formatCOP(previewInvoice.total)}</span></div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setPreviewInvoice(null)}>Cerrar</Button>
              <Button onClick={printInvoice}><Printer className="w-4 h-4" /> Imprimir</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
