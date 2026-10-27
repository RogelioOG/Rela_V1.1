import { useState, useMemo, useEffect } from 'react';
import { Calculator, Loader2, AlertTriangle, CheckCircle2, FileText } from 'lucide-react';
import { Unit } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { formatCOP } from '@/lib/format';

interface AcuerdosPagoModalProps {
  open: boolean;
  onClose: () => void;
  units: Unit[];
  onSubmit: (data: AcuerdoPagoData) => Promise<void>;
}

export interface AcuerdoPagoData {
  unit_id: string;
  start_period: string;
  end_period: string;
  months: number;
  monthly_amount: number;
}

interface ScheduleRow {
  installment: number;
  period: string;
  amount: number;
}

function addMonthsToPeriod(period: string, monthsToAdd: number): string {
  const [y, m] = period.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + monthsToAdd;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function countMonthsBetween(start: string, end: string): number {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  return (ey * 12 + (em - 1)) - (sy * 12 + (sm - 1)) + 1;
}

function isValidPeriod(period: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

export function AcuerdosPagoModal({ open, onClose, units, onSubmit }: AcuerdosPagoModalProps) {
  const [unitId, setUnitId] = useState('');
  const [startPeriod, setStartPeriod] = useState('');
  const [endPeriod, setEndPeriod] = useState('');
  const [months, setMonths] = useState('1');
  const [monthlyAmount, setMonthlyAmount] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (open) {
      setUnitId('');
      setStartPeriod(new Date().toISOString().slice(0, 7));
      setEndPeriod('');
      setMonths('1');
      setMonthlyAmount('0');
      setError('');
      setSuccess('');
    }
  }, [open]);

  useEffect(() => {
    if (startPeriod && endPeriod && isValidPeriod(startPeriod) && isValidPeriod(endPeriod)) {
      const count = countMonthsBetween(startPeriod, endPeriod);
      if (count > 0) setMonths(String(count));
    }
  }, [startPeriod, endPeriod]);

  const schedule: ScheduleRow[] = useMemo(() => {
    const numMonths = parseInt(months) || 0;
    const amount = parseFloat(monthlyAmount) || 0;
    if (numMonths <= 0 || !isValidPeriod(startPeriod) || amount <= 0) return [];
    const rows: ScheduleRow[] = [];
    for (let i = 0; i < numMonths; i++) {
      rows.push({
        installment: i + 1,
        period: addMonthsToPeriod(startPeriod, i),
        amount,
      });
    }
    return rows;
  }, [months, monthlyAmount, startPeriod]);

  const totalAmount = useMemo(() => schedule.reduce((s, r) => s + r.amount, 0), [schedule]);

  function validate(): string | null {
    if (!unitId) return 'Debe seleccionar una propiedad.';
    if (!isValidPeriod(startPeriod)) return 'El periodo inicial debe tener formato YYYY-MM.';
    if (!isValidPeriod(endPeriod)) return 'El periodo final debe tener formato YYYY-MM.';
    const numMonths = parseInt(months) || 0;
    if (numMonths <= 0) return 'El número de cuotas debe ser mayor que cero.';
    const expectedMonths = countMonthsBetween(startPeriod, endPeriod);
    if (expectedMonths !== numMonths) return `El rango de periodos indica ${expectedMonths} mes(es), pero el número de cuotas es ${numMonths}.`;
    const amount = parseFloat(monthlyAmount) || 0;
    if (amount <= 0) return 'El valor de la cuota mensual debe ser mayor que cero.';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess('');
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setSaving(true);
    try {
      await onSubmit({
        unit_id: unitId,
        start_period: startPeriod,
        end_period: endPeriod,
        months: parseInt(months) || 0,
        monthly_amount: parseFloat(monthlyAmount) || 0,
      });
      setSuccess('Acuerdo de pago registrado correctamente.');
      setSaving(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al registrar el acuerdo de pago';
      setError(msg);
      setSaving(false);
    }
  }

  const selectedUnit = units.find(u => u.id === unitId);

  return (
    <Modal open={open} onClose={onClose} title="Registrar Acuerdo de Pago" size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {success && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-3 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-green-700">{success}</p>
          </div>
        )}

        <Select label="Propiedad *" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">Seleccione una propiedad...</option>
          {units.map(u => (
            <option key={u.id} value={u.id}>{u.tower} — {u.unit_label} ({u.owner_name})</option>
          ))}
        </Select>

        {selectedUnit && (
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 flex items-center gap-3">
            <FileText className="w-4 h-4 text-gray-500" />
            <div className="text-sm text-gray-600">
              <span className="font-medium text-gray-900">{selectedUnit.tower} {selectedUnit.unit_label}</span>
              {' — '}
              Coeficiente: {selectedUnit.coefficient.toFixed(4)}
              {selectedUnit.owner_name && <span> · Propietario: {selectedUnit.owner_name}</span>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Periodo Inicial (YYYY-MM) *"
            type="text"
            value={startPeriod}
            onChange={(e) => setStartPeriod(e.target.value)}
            placeholder="2026-10"
          />
          <Input
            label="Periodo Final (YYYY-MM) *"
            type="text"
            value={endPeriod}
            onChange={(e) => setEndPeriod(e.target.value)}
            placeholder="2026-12"
          />
          <Input
            label="Número de Cuotas *"
            type="number"
            min="1"
            value={months}
            onChange={(e) => setMonths(e.target.value)}
          />
          <Input
            label="Valor Cuota Mensual (COP) *"
            type="number"
            step="0.01"
            min="0"
            value={monthlyAmount}
            onChange={(e) => setMonthlyAmount(e.target.value)}
          />
        </div>

        {schedule.length > 0 && (
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Calculator className="w-4 h-4 text-blue-600" />
                Plan de Amortización
              </h3>
              <span className="text-sm text-gray-500">
                Total: <strong className="text-gray-900">{formatCOP(totalAmount)}</strong>
              </span>
            </div>
            <div className="overflow-x-auto max-h-56 overflow-y-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 sticky top-0">
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2">#</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2">Periodo</th>
                    <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-2">Cuota Mensual</th>
                    <th className="text-center text-xs font-semibold text-gray-600 uppercase px-4 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {schedule.map((row) => (
                    <tr key={row.installment} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-sm text-gray-700">{row.installment}</td>
                      <td className="px-4 py-2.5 text-sm font-medium text-gray-900">{row.period}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-900 text-right">{formatCOP(row.amount)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge variant="gray">Pendiente</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={2} className="px-4 py-2.5 text-sm font-semibold text-gray-900 text-right">Total:</td>
                    <td className="px-4 py-2.5 text-right text-sm font-bold text-gray-900">{formatCOP(totalAmount)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cerrar</Button>
          <Button type="submit" disabled={saving || units.length === 0}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Registrar Acuerdo
          </Button>
        </div>
      </form>
    </Modal>
  );
}
