import { useEffect, useState } from 'react';
import { FileText, Plus, Loader2, Zap, AlertCircle } from 'lucide-react';
import { supabase, Due, Unit } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, formatShortDate, dueTypeLabels, dueStatusLabels } from '@/lib/format';

export default function CarteraPage() {
  const { activeOrg } = useOrg();
  const [dues, setDues] = useState<Due[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [genForm, setGenForm] = useState({ period: '', due_date: '', amount: '', type: 'ordinaria', interest_rate: '0' });
  const [genSaving, setGenSaving] = useState(false);
  const [genError, setGenError] = useState('');
  const [genResult, setGenResult] = useState('');

  useEffect(() => { if (activeOrg) loadData(); }, [activeOrg]);

  async function loadData() {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: duesData }, { data: unitsData }] = await Promise.all([
      supabase.from('dues').select('*, units(*)').eq('organization_id', activeOrg.id).order('due_date', { ascending: false }),
      supabase.from('units').select('*').eq('organization_id', activeOrg.id).eq('is_active', true).order('unit_label'),
    ]);
    setDues(duesData || []);
    setUnits(unitsData || []);
    setLoading(false);
  }

  function calculateInterest(due: Due): number {
    if (due.status === 'pagada') return 0;
    const today = new Date();
    const dueDate = new Date(due.due_date);
    const daysLate = Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));
    if (daysLate === 0) return 0;
    return Math.round(due.balance * due.interest_rate * daysLate);
  }

  function getDaysLate(due: Due): number {
    if (due.status === 'pagada') return 0;
    const today = new Date();
    const dueDate = new Date(due.due_date);
    return Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setGenSaving(true); setGenError(''); setGenResult('');
    if (!activeOrg) return;
    if (units.length === 0) { setGenError('No hay unidades registradas'); setGenSaving(false); return; }
    const amount = parseFloat(genForm.amount) || 0;
    const interestRate = parseFloat(genForm.interest_rate) || 0;
    const records = units.map(u => ({
      organization_id: activeOrg.id, unit_id: u.id, type: genForm.type, period: genForm.period,
      due_date: genForm.due_date, amount, interest_rate: interestRate, balance: amount, status: 'pendiente',
    }));
    const { data, error: err } = await supabase.from('dues').insert(records).select();
    if (err) { setGenError(err.message); setGenSaving(false); return; }
    setGenResult(`Se generaron ${(data || []).length} cuotas para ${units.length} unidad(es)`);
    setGenSaving(false);
    await loadData();
  }

  if (!activeOrg) return <NoOrgSelected />;

  const totalPendiente = dues.filter(d => d.status !== 'pagada').reduce((s, d) => s + d.balance, 0);
  const totalIntereses = dues.filter(d => d.status !== 'pagada').reduce((s, d) => s + calculateInterest(d), 0);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cartera y Cuotas</h1>
          <p className="text-gray-500 mt-1">Cuotas de administración y saldos pendientes</p>
        </div>
        <Button onClick={() => setGenerateOpen(true)}><Zap className="w-4 h-4" /> Generación Masiva</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card><CardBody>
          <p className="text-sm text-gray-500">Saldo Pendiente</p>
          <p className="text-xl font-bold text-red-600">{formatCOP(totalPendiente)}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-sm text-gray-500">Intereses de Mora</p>
          <p className="text-xl font-bold text-yellow-600">{formatCOP(totalIntereses)}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-sm text-gray-500">Total Cartera</p>
          <p className="text-xl font-bold text-gray-900">{formatCOP(totalPendiente + totalIntereses)}</p>
        </CardBody></Card>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : dues.length === 0 ? (
          <div className="text-center py-16"><div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><FileText className="w-8 h-8 text-gray-400" /></div><p className="text-gray-500">No hay cuotas registradas</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Unidad</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Periodo</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Tipo</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Vencimiento</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Saldo</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Interés Mora</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {dues.map(due => {
                  const interest = calculateInterest(due);
                  const daysLate = getDaysLate(due);
                  return (
                    <tr key={due.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4"><p className="text-sm font-medium text-gray-900">{due.units?.unit_label || 'N/A'}</p><p className="text-xs text-gray-500">{due.units?.tower || ''}</p></td>
                      <td className="px-6 py-4 text-sm text-gray-700">{due.period}</td>
                      <td className="px-6 py-4 hidden md:table-cell"><Badge variant={due.type === 'ordinaria' ? 'blue' : 'yellow'}>{dueTypeLabels[due.type]}</Badge></td>
                      <td className="px-6 py-4 text-sm text-gray-700">{formatShortDate(due.due_date)}{daysLate > 0 && <span className="text-xs text-red-500 block">{daysLate} día(s) de mora</span>}</td>
                      <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">{formatCOP(due.balance)}</td>
                      <td className="px-6 py-4 text-right text-sm hidden lg:table-cell">{interest > 0 ? <span className="text-yellow-600 font-medium">{formatCOP(interest)}</span> : <span className="text-gray-400">-</span>}</td>
                      <td className="px-6 py-4"><Badge variant={due.status === 'pagada' ? 'green' : due.status === 'parcial' ? 'yellow' : due.status === 'anulada' ? 'gray' : 'red'}>{dueStatusLabels[due.status]}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={generateOpen} onClose={() => { setGenerateOpen(false); setGenResult(''); setGenError(''); }} title="Generación Masiva de Cuotas" size="lg">
        <form onSubmit={handleGenerate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Tipo de Cuota" value={genForm.type} onChange={(e) => setGenForm({ ...genForm, type: e.target.value })}>
              <option value="ordinaria">Ordinaria</option>
              <option value="extraordinaria">Extraordinaria</option>
            </Select>
            <Input label="Periodo *" value={genForm.period} onChange={(e) => setGenForm({ ...genForm, period: e.target.value })} required placeholder="Ej: 2026-09" />
            <Input label="Fecha de Vencimiento *" type="date" value={genForm.due_date} onChange={(e) => setGenForm({ ...genForm, due_date: e.target.value })} required />
            <Input label="Monto (COP) *" type="number" step="0.01" value={genForm.amount} onChange={(e) => setGenForm({ ...genForm, amount: e.target.value })} required />
            <Input label="Tasa de Interés Diario" type="number" step="0.0001" value={genForm.interest_rate} onChange={(e) => setGenForm({ ...genForm, interest_rate: e.target.value })} placeholder="Ej: 0.0010 (0.10%)" />
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
            <AlertCircle className="w-4 h-4 text-blue-600" />
            <p className="text-xs text-blue-700">Se generarán cuotas para las {units.length} unidad(es) activa(s)</p>
          </div>
          {genError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{genError}</p></div>}
          {genResult && <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3"><p className="text-sm text-green-700">{genResult}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setGenerateOpen(false)}>Cerrar</Button>
            <Button type="submit" disabled={genSaving}>{genSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Generando...</> : <><Zap className="w-4 h-4" /> Generar Cuotas</>}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
