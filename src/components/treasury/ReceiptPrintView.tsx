import { formatCOP } from '@/lib/format';

export interface ReceiptLine {
  period: string;
  dueDate: string;
  conceptName: string;
  conceptCode: string;
  initialBalance: number;
  discount: number;
  applied: number;
  balanceAfter: number;
}

export interface PrintableReceipt {
  receiptNumber: string;
  organizationName: string;
  organizationNit?: string;
  unitLabel: string;
  ownerName: string;
  paymentDate: string;
  accountingDate: string;
  methodName: string;
  total: number;
  applied: number;
  advance: number;
  notes?: string;
  lines: ReceiptLine[];
}

interface ReceiptPrintViewProps {
  receipt: PrintableReceipt;
}

export function ReceiptPrintView({ receipt }: ReceiptPrintViewProps) {
  const totalInitial = receipt.lines.reduce((sum, l) => sum + l.initialBalance, 0);
  const totalDiscount = receipt.lines.reduce((sum, l) => sum + l.discount, 0);
  const totalAppliedLines = receipt.lines.reduce((sum, l) => sum + l.applied, 0);
  const totalBalanceAfter = receipt.lines.reduce((sum, l) => sum + l.balanceAfter, 0);

  return (
    <div className="bg-white p-8 text-gray-900 max-w-3xl mx-auto space-y-6 text-sm">
      {/* Encabezado */}
      <div className="flex justify-between items-start border-b border-gray-300 pb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{receipt.organizationName}</h1>
          {receipt.organizationNit && <p className="text-xs text-gray-600">NIT: {receipt.organizationNit}</p>}
          <p className="text-xs text-gray-500 mt-1">Propiedad Horizontal</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Recibo de Caja</p>
          <p className="text-xl font-mono font-bold text-blue-700">{receipt.receiptNumber}</p>
        </div>
      </div>

      {/* Datos Generales */}
      <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
        <div className="space-y-1">
          <p><strong className="text-gray-600">Unidad:</strong> {receipt.unitLabel}</p>
          <p><strong className="text-gray-600">Propietario:</strong> {receipt.ownerName || 'N/A'}</p>
          <p><strong className="text-gray-600">Método de pago:</strong> {receipt.methodName}</p>
        </div>
        <div className="space-y-1 text-right">
          <p><strong className="text-gray-600">Fecha de pago:</strong> {receipt.paymentDate}</p>
          <p><strong className="text-gray-600">Fecha contable:</strong> {receipt.accountingDate}</p>
          <p><strong className="text-gray-600">Valor recibido:</strong> <span className="font-bold text-gray-900">{formatCOP(receipt.total)}</span></p>
        </div>
      </div>

      {receipt.notes && (
        <div className="text-xs bg-gray-50 p-3 rounded border border-gray-200">
          <strong className="text-gray-700">Notas:</strong> {receipt.notes}
        </div>
      )}

      {/* Tabla de Detalle de Aplicación */}
      <div>
        <h3 className="text-xs font-semibold uppercase text-gray-600 mb-2">Detalle de Aplicación del Recibo</h3>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-100 border-b border-gray-200 text-gray-700">
              <tr>
                <th className="px-3 py-2 font-semibold">Período</th>
                <th className="px-3 py-2 font-semibold">Concepto</th>
                <th className="px-3 py-2 font-semibold text-right">Saldo Inicial</th>
                <th className="px-3 py-2 font-semibold text-right">Descuento</th>
                <th className="px-3 py-2 font-semibold text-right">Valor Aplicado</th>
                <th className="px-3 py-2 font-semibold text-right">Saldo Restante</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {receipt.lines.map((line, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{line.period}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono bg-gray-100 px-1 rounded mr-1 text-[10px]">{line.conceptCode}</span>
                    {line.conceptName}
                  </td>
                  <td className="px-3 py-2 text-right">{formatCOP(line.initialBalance)}</td>
                  <td className="px-3 py-2 text-right text-green-600 font-medium">
                    {line.discount > 0 ? formatCOP(line.discount) : '$ 0'}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-blue-700">{formatCOP(line.applied)}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-700">{formatCOP(line.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200 font-semibold">
              <tr>
                <td colSpan={2} className="px-3 py-2 text-gray-800">Totales</td>
                <td className="px-3 py-2 text-right">{formatCOP(totalInitial)}</td>
                <td className="px-3 py-2 text-right text-green-600">{formatCOP(totalDiscount)}</td>
                <td className="px-3 py-2 text-right text-blue-700">{formatCOP(totalAppliedLines)}</td>
                <td className="px-3 py-2 text-right">{formatCOP(totalBalanceAfter)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Resumen Financiero Final */}
      <div className="flex justify-end pt-2">
        <div className="w-72 space-y-1.5 bg-gray-50 p-4 rounded-lg border border-gray-200 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-600">Total aplicado a deudas:</span>
            <span className="font-semibold">{formatCOP(receipt.applied)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Anticipo / Saldo a favor:</span>
            <span className="font-semibold text-green-700">{formatCOP(receipt.advance)}</span>
          </div>
          <div className="flex justify-between border-t border-gray-300 pt-2 text-sm font-bold">
            <span>Total Recibido:</span>
            <span>{formatCOP(receipt.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}