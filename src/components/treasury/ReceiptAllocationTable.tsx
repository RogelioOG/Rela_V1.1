import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { formatCOP } from '@/lib/format';
import { DetailedDueItem, parseAmount } from './receiptAllocation';

export type DetailedAllocationInputs = Record<string, string>;
export type DetailedDiscountOverrides = Record<string, number>;

interface ReceiptAllocationTableProps {
  items: DetailedDueItem[];
  inputs: DetailedAllocationInputs;
  discountOverrides?: DetailedDiscountOverrides;
  onChange: (itemId: string, value: string) => void;
  onDiscountChange?: (itemId: string, newDiscount: number) => void;
}

const inputClass =
  'w-36 rounded-lg border border-gray-300 px-3 py-2 text-right text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50';

const discountInputClass =
  'w-28 rounded-md border border-blue-300 bg-white px-2 py-1 text-right text-xs font-medium text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

export function getEffectiveDiscount(
  item: DetailedDueItem,
  discountOverrides?: DetailedDiscountOverrides
): number {
  if (discountOverrides && Object.prototype.hasOwnProperty.call(discountOverrides, item.id)) {
    const val = Number(discountOverrides[item.id]);
    if (!Number.isFinite(val) || val < 0) return 0;
    return Math.min(val, item.balance);
  }
  return Number(item.discountAmount || 0);
}

export function ReceiptAllocationTable({
  items,
  inputs,
  discountOverrides,
  onChange,
  onDiscountChange,
}: ReceiptAllocationTableProps) {
  const [editingDiscountId, setEditingDiscountId] = useState<string | null>(null);
  const [draftDiscountValue, setDraftDiscountValue] = useState<string>('');

  const totalApplied = items.reduce((sum, item) => sum + parseAmount(inputs[item.id] ?? '0'), 0);
  const totalBalance = items.reduce((sum, item) => sum + item.balance, 0);
  const totalDiscounts = items.reduce(
    (sum, item) => sum + getEffectiveDiscount(item, discountOverrides),
    0
  );
  const totalNetBalance = Math.max(totalBalance - totalDiscounts, 0);

  function startEditDiscount(item: DetailedDueItem) {
    const currentDisc = getEffectiveDiscount(item, discountOverrides);
    setEditingDiscountId(item.id);
    setDraftDiscountValue(String(currentDisc));
  }

  function commitDiscountEdit(item: DetailedDueItem) {
    if (!onDiscountChange) {
      setEditingDiscountId(null);
      return;
    }
    const parsed = parseAmount(draftDiscountValue);
    const clamped = Math.max(0, Math.min(parsed, item.balance));
    onDiscountChange(item.id, clamped);
    setEditingDiscountId(null);
  }

  function clearDiscount(item: DetailedDueItem) {
    if (editingDiscountId === item.id) {
      setEditingDiscountId(null);
    }
    if (onDiscountChange) {
      onDiscountChange(item.id, 0);
    }
  }

  return (
    <div className="space-y-6">
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
              {items.map(item => {
                const effectiveDisc = getEffectiveDiscount(item, discountOverrides);
                return (
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
                      {effectiveDisc > 0 ? formatCOP(effectiveDisc) : '$ 0'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-sm">
                <td colSpan={3} className="px-4 py-3 text-gray-900">Total Saldo Pendiente Base</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatCOP(totalBalance)}</td>
                <td className="px-4 py-3 text-right text-green-600">{totalDiscounts > 0 ? formatCOP(totalDiscounts) : '$ 0'}</td>
              </tr>
              {totalDiscounts > 0 && (
                <tr className="border-t border-gray-100 bg-green-50/40 font-bold text-sm">
                  <td colSpan={3} className="px-4 py-2.5 text-green-900">Total Descuento Pronto Pago Aplicado</td>
                  <td className="px-4 py-2.5 text-right text-green-700" />
                  <td className="px-4 py-2.5 text-right text-green-700">- {formatCOP(totalDiscounts)}</td>
                </tr>
              )}
              <tr className="border-t border-gray-200 bg-gray-100 font-bold text-sm">
                <td colSpan={3} className="px-4 py-3 text-gray-900">Total Neto a Pagar (Con Descuento)</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatCOP(totalNetBalance)}</td>
                <td className="px-4 py-3 text-right text-green-700">{formatCOP(totalDiscounts)} dto.</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-gray-800">2. Aplicación real del pago por concepto (Campos editables)</h3>
          <p className="text-xs text-gray-500">Ajuste libremente el monto a aplicar o edite/elimine el descuento de cada concepto.</p>
        </div>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Período</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-3">Concepto Discriminado</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Saldo Base</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Descuento</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Valor a Aplicar</th>
                <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-3">Nuevo Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {items.map(item => {
                const appliedVal = parseAmount(inputs[item.id] ?? '0');
                const discount = getEffectiveDiscount(item, discountOverrides);
                const netItemBalance = Math.max(item.balance - discount, 0);
                const coveredVal = appliedVal + discount;
                const isOverflow = appliedVal > netItemBalance;
                const remaining = Math.max(item.balance - coveredVal, 0);
                const isEditingDisc = editingDiscountId === item.id;

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
                    <td className="px-4 py-3 text-sm text-right">
                      {isEditingDisc ? (
                        <div className="inline-flex items-center justify-end gap-1">
                          <input
                            type="number"
                            min={0}
                            max={item.balance}
                            step="0.01"
                            value={draftDiscountValue}
                            onChange={e => setDraftDiscountValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitDiscountEdit(item);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingDiscountId(null);
                              }
                            }}
                            className={discountInputClass}
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => commitDiscountEdit(item)}
                            title="Guardar descuento"
                            className="p-1 rounded text-green-700 hover:bg-green-50"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingDiscountId(null)}
                            title="Cancelar edición de descuento"
                            className="p-1 rounded text-gray-500 hover:bg-gray-100"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <span className={discount > 0 ? 'text-green-600 font-medium' : 'text-gray-500'}>
                            {discount > 0 ? formatCOP(discount) : '$ 0'}
                          </span>
                          {onDiscountChange && (
                            <>
                              <button
                                type="button"
                                onClick={() => startEditDiscount(item)}
                                title="Editar descuento"
                                className="p-1 rounded text-gray-500 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {discount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => clearDiscount(item)}
                                  title="Eliminar descuento"
                                  className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </td>
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
                      {isOverflow && <p className="mt-1 text-xs text-red-600">Supera el saldo neto</p>}
                    </td>
                    <td className={`px-4 py-3 text-sm text-right font-medium ${remaining === 0 ? 'text-green-700 font-bold' : 'text-gray-700'}`}>
                      {formatCOP(remaining)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-sm">
                <td colSpan={4} className="px-4 py-3 text-gray-900">Total Aplicado a Conceptos</td>
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