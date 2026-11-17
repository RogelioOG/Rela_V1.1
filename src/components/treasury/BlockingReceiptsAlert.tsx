import { AlertTriangle, Ban, FileText } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatCOP } from '@/lib/format';

export interface BlockingReceipt {
  receipt_id: string;
  receipt_number: string;
  tower: string | null;
  unit_label: string;
  payment_date: string;
  total_amount: number;
}

interface BlockingReceiptsAlertProps {
  open: boolean;
  onClose: () => void;
  period: string;
  receipts: BlockingReceipt[];
  maxVisible?: number;
}

export function BlockingReceiptsAlert({ open, onClose, period, receipts, maxVisible = 10 }: BlockingReceiptsAlertProps) {
  const visible = receipts.slice(0, maxVisible);
  const hiddenCount = receipts.length - visible.length;

  return (
    <Modal open={open} onClose={onClose} title="Eliminación bloqueada" size="md">
      <div className="space-y-4">
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              No se puede eliminar la facturación del período {period}
            </p>
            <p className="text-sm text-amber-800 mt-1">
              Hay recibos de caja activos con pagos aplicados a estas obligaciones. Debe anular o eliminar primero
              los siguientes recibos para liberar los saldos:
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase text-xs">
              <tr>
                <th className="px-4 py-2">Recibo</th>
                <th className="px-4 py-2">Unidad</th>
                <th className="px-4 py-2">Fecha de pago</th>
                <th className="px-4 py-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map(r => (
                <tr key={r.receipt_id}>
                  <td className="px-4 py-2 font-mono font-semibold text-blue-700">
                    <span className="inline-flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-gray-400" />
                      {r.receipt_number}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-900">
                    {r.tower ? `Torre ${r.tower} · ${r.unit_label}` : r.unit_label}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{r.payment_date}</td>
                  <td className="px-4 py-2 text-right text-gray-900">{formatCOP(Number(r.total_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hiddenCount > 0 && (
          <p className="text-xs text-gray-500">
            Mostrando los primeros {visible.length} de {receipts.length} recibos asociados. Hay {hiddenCount} más no
            listados para no afectar el rendimiento.
          </p>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            <Ban className="w-4 h-4" /> Entendido
          </Button>
        </div>
      </div>
    </Modal>
  );
}
