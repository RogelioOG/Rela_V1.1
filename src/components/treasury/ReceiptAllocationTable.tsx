import { Badge } from '@/components/ui/Badge';
import { formatCOP } from '@/lib/format';
import type { Due } from '@/lib/supabase';
import { parseAmount } from './receiptAllocation';

export interface AllocationInput {
  capital: string;
  interest: string;
}

export type AllocationInputs = Record<string, AllocationInput>;

interface ReceiptAllocationTableProps {
  dues: Due[];
  inputs: AllocationInputs;
  onChange: (dueId: string, field: keyof AllocationInput, value: string) => void;
}

const inputClass =
  'w-32 rounded-lg border border-gray-300 px-3 py-2 text-right text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50';

export function ReceiptAllocationTable({ dues, inputs, onChange }: ReceiptAllocationTableProps) {
  const totalCapital = dues.reduce((sum, d) => sum + parseAmount(inputs[d.id]?.capital ?? '0'), 0);
  const totalInterest = dues.reduce((sum, d) => sum + parseAmount(inputs[d.id]?.interest ?? '0'), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Período</th>
            <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Vencimiento</th>
            <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Saldo pendiente</th>
            <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Capital a aplicar</th>
            <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Intereses a aplicar</th>
            <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Saldo después</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {dues.map(due => {
            const capital = parseAmount(inputs[due.id]?.capital ?? '0');
            const interest = parseAmount(inputs[due.id]?.interest ?? '0');
            const overCapital = capital > due.balance;
            const remainingBalance = Math.max(due.balance - capital, 0);
            return (
              <tr key={due.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                  <div className="flex items-center gap-2">
                    {due.period}
                    {capital + interest > 0 && <Badge variant="blue">Se aplica</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">{due.due_date}</td>
                <td className="px-4 py-3 text-sm text-right text-gray-900">{formatCOP(due.balance)}</td>
                <td className="px-4 py-3 text-right">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={`Capital a aplicar al período ${due.period}`}
                    value={inputs[due.id]?.capital ?? ''}
                    onChange={e => onChange(due.id, 'capital', e.target.value)}
                    className={`${inputClass} ${overCapital ? 'border-red-400 bg-red-50' : ''}`}
                  />
                  {overCapital && <p className="mt-1 text-xs text-red-600">Supera el saldo</p>}
                </td>
                <td className="px-4 py-3 text-right">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={`Intereses a aplicar al período ${due.period}`}
                    value={inputs[due.id]?.interest ?? ''}
                    onChange={e => onChange(due.id, 'interest', e.target.value)}
                    className={inputClass}
                  />
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-700">{formatCOP(remainingBalance)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200 bg-gray-50">
            <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-gray-900">Totales aplicados</td>
            <td className="px-4 py-3 text-sm font-semibold text-right text-gray-900">{formatCOP(totalCapital)}</td>
            <td className="px-4 py-3 text-sm font-semibold text-right text-gray-900">{formatCOP(totalInterest)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
