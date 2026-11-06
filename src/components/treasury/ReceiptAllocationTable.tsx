import { Badge } from '@/components/ui/Badge';
import { formatCOP } from '@/lib/format';
import { DetailedDueItem, parseAmount } from './receiptAllocation';

export type DetailedAllocationInputs = Record<string, string>;

interface ReceiptAllocationTableProps {
  items: DetailedDueItem[];
  inputs: DetailedAllocationInputs;
  onChange: (itemId: string, value: string) => void;
}

const inputClass =
  'w-36 rounded-lg border border-gray-300 px-3 py-2 text-right text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50';

export function ReceiptAllocationTable({ items, inputs, onChange }: ReceiptAllocationTableProps) {
  const totalApplied = items.reduce((sum, item) => sum + parseAmount(inputs[item.id] ?? '0'), 0);
  const totalBalance = items.reduce((sum, item) => sum + item.balance, 0);

  return (
    <div className="space-y-6">
      {/* TABLA 1: OBLIGACIONES PENDIENTES DISCRIMINADAS POR CONCEPTO */}
      <div>
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-gray-800">1. Detalle de obligaciones pendientes por concepto</h3>
          <p className="text-xs text-gray-500">Orden de prelación parametrizado + antigüedad (más antiguo a más reciente).</p>
        </div>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Período</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Concepto Discriminado</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Vencimiento</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Saldo Pendiente Base</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Descuento Pronto Pago</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {items.map(item => (
                <tr key={`info-${item.id}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.period}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">{item.conceptCode}</span>
                      <span>{item.conceptName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{item.dueDate}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">{formatCOP(item.balance)}</td>
                  <td className="px-4 py-3 text-sm text-right text-green-600 font-medium">
                    {item.discountAmount > 0 ? formatCOP(item.discountAmount) : '$ 0'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-sm">
                <td colSpan={3} className="px-4 py-3 text-gray-900">Total Saldo Pendiente</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatCOP(totalBalance)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* TABLA 2: APLICACIÓN REAL DEL PAGO (Campos Editables por Concepto) */}
      <div>
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-gray-800">2. Aplicación real del pago por concepto (Campos editables)</h3>
          <p className="text-xs text-gray-500">Ajuste libremente el monto a aplicar para cada concepto individual en el orden sugerido.</p>
        </div>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Período</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Concepto Discriminado</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Saldo Pendiente</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Valor a Aplicar</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Nuevo Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {items.map(item => {
                const appliedVal = parseAmount(inputs[item.id] ?? '0');
                const isOverflow = appliedVal > item.balance;
                const remaining = Math.max(item.balance - appliedVal, 0);

                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.period}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">{item.conceptCode}</span>
                        <span>{item.conceptName}</span>
                        {appliedVal > 0 && <Badge variant="blue">Aplicando</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900">{formatCOP(item.balance)}</td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label={`Valor a aplicar a ${item.conceptName} período ${item.period}`}
                        value={inputs[item.id] ?? ''}
                        onChange={e => onChange(item.id, e.target.value)}
                        className={`${inputClass} ${isOverflow ? 'border-red-400 bg-red-50 text-red-900' : ''}`}
                      />
                      {isOverflow && <p className="mt-1 text-xs text-red-600">Supera el saldo</p>}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-700">{formatCOP(remaining)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-sm">
                <td colSpan={3} className="px-4 py-3 text-gray-900">Total Aplicado a Conceptos</td>
                <td className="px-4 py-3 text-right text-blue-700 font-bold">{formatCOP(totalApplied)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}