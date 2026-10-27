import { useEffect, useState } from 'react';
import { Landmark, Plus, Loader2, CheckCircle } from 'lucide-react';
import { supabase, Due, Payment, Unit } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, formatShortDate, paymentMethodLabels, dueTypeLabels } from '@/lib/format';

export default function RecaudosPage() {
  const { activeOrg } = useOrg();
  const [pendingDues, setPendingDues] = useState<Due[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDue, setSelectedDue] = useState<Due | null>(null);
  const [form, setForm] = useState({ amount: '', date: new Date().toISOString().slice(0, 10), method: 'efectivo', reference: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (activeOrg) loadData(); }, [activeOrg]);

  async function loadData() {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: dues }, { data: pays }, { data: unitsData }] = await Promise.all([
      supabase.from('dues').select('*, units(*)').eq('organization_id', activeOrg.id).in('status', ['pendiente', 'parcial']).order('due_date', { ascending: true }),
      supabase.from('payments').select('*, dues(*)').eq('organization_id', activeOrg.id).order('date', { ascending: false }).limit(20),
      supabase.from('units').select('*').eq('organization_id', activeOrg.id).eq('is_active', true).order('unit_label'),
    ]);
    setPendingDues(dues || []);
    setPayments(pays || []);
    setUnits(unitsData || []);
    setLoading(false);
  }

  function openPayment(due: Due) {
    setSelectedDue(due);
    setForm({ amount: String(due.balance), date: new Date().toISOString().slice(0, 10), method: 'efectivo', reference: '' });
    setError(''); setModalOpen(true);
  }

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    if (!activeOrg || !selectedDue) return;
    const amount = parseFloat(form.amount) || 0;
    if (amount <= 0) { setError('El monto debe ser mayor a 0'); setSaving(false); return; }

    const { error: payErr } = await supabase.from('payments').insert({
      organization_id: activeOrg.id, due_id: selectedDue.id, unit_id: selectedDue.unit_id,
      date: form.date, amount, method: form.method, reference: form.reference,
    });
    if (payErr) { setError(payErr.message); setSaving(false); return; }

    const newBalance = selectedDue.balance - amount;
    const newStatus = newBalance <= 0 ? 'pagada' : 'parcial';
    const { error: dueErr } = await supabase.from('dues').update({ balance: Math.max(0, newBalance), status: newStatus }).eq('id', selectedDue.id);
    if (dueErr) { setError(dueErr.message); setSaving(false); return; }

    setSaving(false); setModalOpen(false); setSelectedDue(null);
    await loadData();
  }

  if (!activeOrg) return <NoOrgSelected />;

  const totalRecaudado = payments.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Recaudos</h1>
        <p className="text-gray-500 mt-1">Registro de pagos de administración</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card><CardBody><p className="text-sm text-gray-500">Cuotas Pendientes</p><p className="text-xl font-bold text-red-600">{pendingDues.length}</p></CardBody></Card>
        <Card><CardBody><p className="text-sm text-gray-500">Total Recaudado (reciente)</p><p className="text-xl font-bold text-green-600">{formatCOP(totalRecaudado)}</p></CardBody></Card>
        <Card><CardBody><p className="text-sm text-gray-500">Pagos Registrados</p><p className="text-xl font-bold text-gray-900">{payments.length}</p></CardBody></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending dues */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-200"><h3 className="text-sm font-semibold text-gray-900">Cuotas Pendientes</h3></div>
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
          ) : pendingDues.length === 0 ? (
            <div className="text-center py-12"><CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-2" /><p className="text-sm text-gray-500">No hay cuotas pendientes</p></div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {pendingDues.map(due => (
                <div key={due.id} className="flex items-center justify-between px-6 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{due.units?.unit_label || 'N/A'} — {due.period}</p>
                    <p className="text-xs text-gray-500">Vence: {formatShortDate(due.due_date)} · {dueTypeLabels[due.type]}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900">{formatCOP(due.balance)}</span>
                    <Button size="sm" onClick={() => openPayment(due)}><Plus className="w-3 h-3" /> Pagar</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent payments */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-200"><h3 className="text-sm font-semibold text-gray-900">Pagos Recientes</h3></div>
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
          ) : payments.length === 0 ? (
            <div className="text-center py-12"><Landmark className="w-10 h-10 text-gray-300 mx-auto mb-2" /><p className="text-sm text-gray-500">No hay pagos registrados</p></div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {payments.map(pay => (
                <div key={pay.id} className="flex items-center justify-between px-6 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{formatCOP(pay.amount)}</p>
                    <p className="text-xs text-gray-500">{formatShortDate(pay.date)} · {paymentMethodLabels[pay.method]}{pay.reference && ` · Ref: ${pay.reference}`}</p>
                  </div>
                  <Badge variant="green">Pagado</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Registrar Pago" size="sm">
        {selectedDue && (
          <form onSubmit={handlePayment} className="space-y-4">
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 space-y-1">
              <div className="flex justify-between"><span className="text-sm text-gray-600">Unidad:</span><span className="text-sm font-medium">{selectedDue.units?.unit_label}</span></div>
              <div className="flex justify-between"><span className="text-sm text-gray-600">Periodo:</span><span className="text-sm font-medium">{selectedDue.period}</span></div>
              <div className="flex justify-between"><span className="text-sm text-gray-600">Saldo:</span><span className="text-sm font-bold text-red-600">{formatCOP(selectedDue.balance)}</span></div>
            </div>
            <Input label="Monto a Pagar (COP) *" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            <Input label="Fecha *" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            <Select label="Método de Pago" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
            </Select>
            <Input label="Referencia" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Opcional" />
            {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Procesando...</> : 'Registrar Pago'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
