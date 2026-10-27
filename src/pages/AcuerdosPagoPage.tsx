import { useEffect, useState, useMemo, useCallback } from 'react';
import { FileText, Plus, Loader2, Search, Download, FileSpreadsheet, Trash2, Eye, Handshake, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase, Unit, PaymentAgreement } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, formatShortDate } from '@/lib/format';
import { AcuerdosPagoModal, AcuerdoPagoData } from '@/components/cartera/AcuerdosPagoModal';

const statusLabels: Record<string, string> = {
  en_cumplimiento: 'En cumplimiento',
  incumplido: 'Incumplido',
  finalizado: 'Finalizado',
};

const statusVariants: Record<string, 'green' | 'red' | 'blue' | 'gray'> = {
  en_cumplimiento: 'green',
  incumplido: 'red',
  finalizado: 'blue',
};

export default function AcuerdosPagoPage() {
  const { activeOrg } = useOrg();
  const [agreements, setAgreements] = useState<PaymentAgreement[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [detailAgreement, setDetailAgreement] = useState<PaymentAgreement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PaymentAgreement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: agrData, error: agrErr }, { data: unitsData }] = await Promise.all([
      supabase
        .from('payment_agreements')
        .select('*, units(*)')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false }),
      supabase
        .from('units')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('unit_label'),
    ]);
    if (agrErr) { setError(agrErr.message); }
    setAgreements((agrData || []) as PaymentAgreement[]);
    setUnits((unitsData || []) as Unit[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { if (activeOrg) loadData(); }, [activeOrg, loadData]);

  const filtered = useMemo(() => {
    return agreements.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (unitFilter !== 'all' && a.unit_id !== unitFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const label = `${a.units?.tower || ''} ${a.units?.unit_label || ''} ${a.units?.owner_name || ''}`.toLowerCase();
        if (!label.includes(q)) return false;
      }
      return true;
    });
  }, [agreements, search, statusFilter, unitFilter]);

  const totalEnCumplimiento = useMemo(
    () => agreements.filter(a => a.status === 'en_cumplimiento').reduce((s, a) => s + (a.total_amount || 0), 0),
    [agreements]
  );
  const totalIncumplido = useMemo(
    () => agreements.filter(a => a.status === 'incumplido').reduce((s, a) => s + (a.total_amount || 0), 0),
    [agreements]
  );
  const totalAcuerdos = agreements.length;

  async function handleCreateAcuerdo(data: AcuerdoPagoData) {
    if (!activeOrg) throw new Error('No hay organización activa');
    const { error: insErr } = await supabase.from('payment_agreements').insert({
      organization_id: activeOrg.id,
      unit_id: data.unit_id,
      start_period: data.start_period,
      end_period: data.end_period,
      months: data.months,
      monthly_amount: data.monthly_amount,
      status: 'en_cumplimiento',
    });
    if (insErr) throw new Error(insErr.message);
    await loadData();
    setModalOpen(false);
  }

  async function handleStatusChange(agreement: PaymentAgreement, newStatus: PaymentAgreement['status']) {
    const { error: updErr } = await supabase
      .from('payment_agreements')
      .update({ status: newStatus })
      .eq('id', agreement.id);
    if (updErr) { setError(updErr.message); return; }
    await loadData();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error: delErr } = await supabase
      .from('payment_agreements')
      .update({ is_active: false })
      .eq('id', deleteTarget.id);
    if (delErr) { setError(delErr.message); setDeleting(false); return; }
    setDeleteTarget(null);
    setDeleting(false);
    await loadData();
  }

  function exportExcel() {
    const rows = filtered.map(a => ({
      'Propiedad': `${a.units?.tower || ''} ${a.units?.unit_label || ''}`,
      'Propietario': a.units?.owner_name || '',
      'Periodo Inicial': a.start_period,
      'Periodo Final': a.end_period,
      'Cuotas': a.months,
      'Cuota Mensual': a.monthly_amount,
      'Total': a.total_amount || (a.monthly_amount * a.months),
      'Estado': statusLabels[a.status] || a.status,
      'Fecha Registro': formatShortDate(a.created_at),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Acuerdos de Pago');
    XLSX.writeFile(wb, `acuerdos_pago_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportPDF() {
    const win = window.open('', '_blank');
    if (!win) { setError('No se pudo abrir la ventana de impresión. Verifique el bloqueador de ventanas emergentes.'); return; }
    const rowsHtml = filtered.map(a => `
      <tr>
        <td>${a.units?.tower || ''} ${a.units?.unit_label || ''}</td>
        <td>${a.units?.owner_name || ''}</td>
        <td>${a.start_period}</td>
        <td>${a.end_period}</td>
        <td style="text-align:right">${a.months}</td>
        <td style="text-align:right">${formatCOP(a.monthly_amount)}</td>
        <td style="text-align:right">${formatCOP(a.total_amount || (a.monthly_amount * a.months))}</td>
        <td>${statusLabels[a.status] || a.status}</td>
      </tr>
    `).join('');
    win.document.write(`
      <html><head><title>Reporte de Acuerdos de Pago</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .meta { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { background: #f3f4f6; text-align: left; padding: 8px; border-bottom: 2px solid #e5e7eb; }
        td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
        .footer { margin-top: 20px; font-size: 11px; color: #9ca3af; }
      </style></head><body>
      <h1>Reporte de Acuerdos de Pago</h1>
      <div class="meta">Organización: ${activeOrg?.name || ''} — Fecha: ${formatShortDate(new Date().toISOString())}</div>
      <table>
        <thead><tr>
          <th>Propiedad</th><th>Propietario</th><th>Periodo Inicial</th><th>Periodo Final</th>
          <th style="text-align:right">Cuotas</th><th style="text-align:right">Cuota Mensual</th>
          <th style="text-align:right">Total</th><th>Estado</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="footer">Rela ERP — Reporte generado el ${new Date().toLocaleString('es-CO')}</div>
      </body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  if (!activeOrg) return <NoOrgSelected />;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Acuerdos de Pago</h1>
          <p className="text-gray-500 mt-1">Planes de financiación para propiedades en morosidad</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={exportExcel} disabled={filtered.length === 0}>
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </Button>
          <Button variant="outline" onClick={exportPDF} disabled={filtered.length === 0}>
            <Download className="w-4 h-4" /> PDF
          </Button>
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4" /> Nuevo Acuerdo de Pago
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card><CardBody>
          <p className="text-sm text-gray-500">Total Acuerdos Activos</p>
          <p className="text-xl font-bold text-gray-900">{totalAcuerdos}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-sm text-gray-500">Monto En Cumplimiento</p>
          <p className="text-xl font-bold text-green-600">{formatCOP(totalEnCumplimiento)}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-sm text-gray-500">Monto Incumplido</p>
          <p className="text-xl font-bold text-red-600">{formatCOP(totalIncumplido)}</p>
        </CardBody></Card>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <Card className="mb-4">
        <div className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por propiedad, torre o propietario..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-48">
            <option value="all">Todos los estados</option>
            <option value="en_cumplimiento">En cumplimiento</option>
            <option value="incumplido">Incumplido</option>
            <option value="finalizado">Finalizado</option>
          </Select>
          <Select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="sm:w-48">
            <option value="all">Todas las propiedades</option>
            {units.map(u => (
              <option key={u.id} value={u.id}>{u.tower} — {u.unit_label}</option>
            ))}
          </Select>
        </div>
      </Card>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4">
              <Handshake className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-gray-500">
              {agreements.length === 0 ? 'No hay acuerdos de pago registrados' : 'No se encontraron acuerdos con los filtros aplicados'}
            </p>
            {agreements.length === 0 && (
              <Button className="mt-4" onClick={() => setModalOpen(true)}>
                <Plus className="w-4 h-4" /> Crear Primer Acuerdo
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Propiedad</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Periodo Inicial</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Periodo Final</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Cuotas</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Cuota Mensual</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Total</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">{a.units?.tower} {a.units?.unit_label}</p>
                      <p className="text-xs text-gray-500">{a.units?.owner_name || ''}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden md:table-cell">{a.start_period}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden md:table-cell">{a.end_period}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 hidden lg:table-cell">{a.months}</td>
                    <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">{formatCOP(a.monthly_amount)}</td>
                    <td className="px-6 py-4 text-right text-sm font-medium text-gray-900 hidden lg:table-cell">{formatCOP(a.total_amount || (a.monthly_amount * a.months))}</td>
                    <td className="px-6 py-4">
                      <Badge variant={statusVariants[a.status] || 'gray'}>
                        {statusLabels[a.status] || a.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDetailAgreement(a)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="Ver detalle"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {a.status === 'en_cumplimiento' && (
                          <button
                            onClick={() => handleStatusChange(a, 'incumplido')}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Marcar incumplido"
                          >
                            <AlertTriangle className="w-4 h-4" />
                          </button>
                        )}
                        {a.status === 'incumplido' && (
                          <button
                            onClick={() => handleStatusChange(a, 'en_cumplimiento')}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                            title="Reactivar"
                          >
                            <Handshake className="w-4 h-4" />
                          </button>
                        )}
                        {a.status !== 'finalizado' && (
                          <button
                            onClick={() => handleStatusChange(a, 'finalizado')}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Marcar finalizado"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteTarget(a)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AcuerdosPagoModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        units={units}
        onSubmit={handleCreateAcuerdo}
      />

      {/* Detail Modal */}
      <Modal
        open={!!detailAgreement}
        onClose={() => setDetailAgreement(null)}
        title="Detalle del Acuerdo de Pago"
        size="lg"
      >
        {detailAgreement && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-1">Propiedad</p>
                <p className="text-sm font-medium text-gray-900">{detailAgreement.units?.tower} {detailAgreement.units?.unit_label}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-1">Propietario</p>
                <p className="text-sm font-medium text-gray-900">{detailAgreement.units?.owner_name || 'N/A'}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-1">Periodo Inicial</p>
                <p className="text-sm font-medium text-gray-900">{detailAgreement.start_period}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-1">Periodo Final</p>
                <p className="text-sm font-medium text-gray-900">{detailAgreement.end_period}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-1">Número de Cuotas</p>
                <p className="text-sm font-medium text-gray-900">{detailAgreement.months}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-1">Cuota Mensual</p>
                <p className="text-sm font-medium text-gray-900">{formatCOP(detailAgreement.monthly_amount)}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-1">Total del Acuerdo</p>
                <p className="text-sm font-bold text-blue-700">{formatCOP(detailAgreement.total_amount || (detailAgreement.monthly_amount * detailAgreement.months))}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-1">Estado</p>
                <Badge variant={statusVariants[detailAgreement.status] || 'gray'}>
                  {statusLabels[detailAgreement.status]}
                </Badge>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">Plan de Cuotas</h3>
              </div>
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 sticky top-0">
                      <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2">#</th>
                      <th className="text-left text-xs font-semibold text-gray-600 uppercase px-4 py-2">Periodo</th>
                      <th className="text-right text-xs font-semibold text-gray-600 uppercase px-4 py-2">Cuota</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Array.from({ length: detailAgreement.months }, (_, i) => {
                      const [y, m] = detailAgreement.start_period.split('-').map(Number);
                      const total = (y * 12 + (m - 1)) + i;
                      const ny = Math.floor(total / 12);
                      const nm = (total % 12) + 1;
                      const period = `${ny}-${String(nm).padStart(2, '0')}`;
                      return (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-sm text-gray-700">{i + 1}</td>
                          <td className="px-4 py-2.5 text-sm font-medium text-gray-900">{period}</td>
                          <td className="px-4 py-2.5 text-sm text-gray-900 text-right">{formatCOP(detailAgreement.monthly_amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setDetailAgreement(null)}>Cerrar</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Confirmar Eliminación"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-700">
              ¿Está seguro de eliminar el acuerdo de pago para{' '}
              <strong>{deleteTarget?.units?.tower} {deleteTarget?.units?.unit_label}</strong>?
              Esta acción no se puede deshacer.
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Eliminar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
