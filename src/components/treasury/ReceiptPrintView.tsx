import { formatCOP } from '@/lib/format';

export interface PrintableReceiptLine {
  period: string;
  dueDate: string;
  capital: number;
  interest: number;
  balanceAfter: number;
}

export interface PrintableReceipt {
  receiptNumber: string;
  organizationName: string;
  organizationNit: string | null;
  unitLabel: string;
  ownerName: string;
  paymentDate: string;
  accountingDate: string;
  methodName: string;
  total: number;
  applied: number;
  advance: number;
  notes: string;
  lines: PrintableReceiptLine[];
}

interface ReceiptPrintViewProps {
  receipt: PrintableReceipt;
}

function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function ReceiptPrintView({ receipt }: ReceiptPrintViewProps) {
  const totalCapital = receipt.lines.reduce((sum, l) => sum + l.capital, 0);
  const totalInterest = receipt.lines.reduce((sum, l) => sum + l.interest, 0);

  return (
    <div id="receipt-print" className="bg-white text-gray-900 p-8 text-sm">
      <div className="flex items-start justify-between border-b-2 border-gray-900 pb-4">
        <div>
          <h2 className="text-xl font-bold">{receipt.organizationName}</h2>
          {receipt.organizationNit && <p className="text-gray-600">NIT {receipt.organizationNit}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-gray-500">Recibo de caja</p>
          <p className="text-lg font-bold">{receipt.receiptNumber}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2 py-4 border-b border-gray-200">
        <p><span className="font-semibold">Unidad:</span> {receipt.unitLabel}</p>
        <p><span className="font-semibold">Propietario:</span> {receipt.ownerName || 'Sin registrar'}</p>
        <p><span className="font-semibold">Fecha de pago:</span> {formatDate(receipt.paymentDate)}</p>
        <p><span className="font-semibold">Fecha contable:</span> {formatDate(receipt.accountingDate)}</p>
        <p><span className="font-semibold">Método de pago:</span> {receipt.methodName}</p>
        <p><span className="font-semibold">Valor recibido:</span> {formatCOP(receipt.total)}</p>
      </div>

      <table className="w-full mt-4">
        <thead>
          <tr className="border-b border-gray-300 text-left text-xs uppercase text-gray-600">
            <th className="py-2">Período</th>
            <th className="py-2">Vencimiento</th>
            <th className="py-2 text-right">Capital</th>
            <th className="py-2 text-right">Intereses</th>
            <th className="py-2 text-right">Descuento</th>
            <th className="py-2 text-right">Saldo restante</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map(line => (
            <tr key={`${line.period}-${line.dueDate}`} className="border-b border-gray-100">
              <td className="py-2">{line.period}</td>
              <td className="py-2">{formatDate(line.dueDate)}</td>
              <td className="py-2 text-right">{formatCOP(line.capital)}</td>
              <td className="py-2 text-right">{formatCOP(line.interest)}</td>
              <td className="py-2 text-right">{formatCOP(0)}</td>
              <td className="py-2 text-right">{formatCOP(line.balanceAfter)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td colSpan={2} className="py-2">Totales aplicados</td>
            <td className="py-2 text-right">{formatCOP(totalCapital)}</td>
            <td className="py-2 text-right">{formatCOP(totalInterest)}</td>
            <td className="py-2 text-right">{formatCOP(0)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      <div className="flex justify-end mt-6">
        <div className="w-64 space-y-1">
          <div className="flex justify-between"><span>Total aplicado</span><span>{formatCOP(receipt.applied)}</span></div>
          <div className="flex justify-between"><span>Anticipo / Saldo a Favor</span><span>{formatCOP(receipt.advance)}</span></div>
          <div className="flex justify-between border-t border-gray-900 pt-1 font-bold"><span>Total recibido</span><span>{formatCOP(receipt.total)}</span></div>
        </div>
      </div>

      {receipt.notes && <p className="mt-6 text-gray-700"><span className="font-semibold">Notas:</span> {receipt.notes}</p>}
    </div>
  );
}
