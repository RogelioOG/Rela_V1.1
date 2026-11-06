import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Printer, RotateCcw } from 'lucide-react';
import { supabase, Due, PaymentHierarchyConfig, PaymentMethod, Unit, BillingConcept } from '@/lib/supabase';
import { formatCOP } from '@/lib/format';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, TextArea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { allocateReceipt, parseAmount, roundMoney } from '@/components/treasury/receiptAllocation';
import { AllocationInput, AllocationInputs, ReceiptAllocationTable } from '@/components/treasury/ReceiptAllocationTable';
import { PrintableReceipt, ReceiptPrintView } from '@/components/treasury/ReceiptPrintView';

interface HeaderState {
  unitId: string;
  paymentDate: string;
  accountingDate: string;
  paymentMethodId: string;
  total: string;
  notes: string;
}

function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function unitLabel(unit: Unit): string {
  return unit.tower ? `Torre ${unit.tower} · ${unit.unit_label}` : unit.unit_label;
}

function toInputs(amounts: Record<string, { capital: number; interest: number }>): AllocationInputs {
  const result: AllocationInputs = {};
  for (const [dueId, amount] of Object.entries(amounts)) {
    result[dueId] = { capital: String(amount.capital), interest: String(amount.interest) };
  }
  return result;
}

export function ReceiptForm() {
  const { activeOrg } = useOrg();
  const today = todayISO();
  const [units, setUnits] = useState<Unit[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [hierarchy, setHierarchy] = useState<PaymentHierarchyConfig[]>([]);
  const [concepts, setConcepts] = useState<BillingConcept[]>([]);
  const [dues, setDues] = useState<Due[]>([]);
  const [header, setHeader] = useState<HeaderState>({
    unitId: '',
    paymentDate: today,
    accountingDate: today,
    paymentMethodId: '',
    total: '',
    notes: '',
  });
  const [overrides, setOverrides] = useState<AllocationInputs | null>(null);
  const [selectedAdvanceConceptId, setSelectedAdvanceConceptId] = useState<string>('');
  const [loadingReference, setLoadingReference] = useState(true);
  const [loadingDues, setLoadingDues] = useState(false);
  const [referenceError, setReferenceError] = useState('');
  const [duesError, setDuesError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [printable, setPrintable] = useState<PrintableReceipt | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  const loadReferenceData = useCallback(async () => {
    if (!activeOrg) return;
    setLoadingReference(true);
    setReferenceError('');

    const [unitsRes, methodsRes, hierarchyRes, conceptsRes] = await Promise.all([
      supabase
        .from('units')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('tower', { ascending: true })
        .order('unit_label', { ascending: true }),
      supabase
        .from('payment_methods')
        .select('*, account:accounts!account_id(*)')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('payment_hierarchy_configs')
        .select('*, billing_concept:billing_concepts!concept_id(*)')
        .eq('organization_id', activeOrg.id)
        .order('priority_order', { ascending: true }),
      supabase
        .from('billing_concepts')
        .select('*')
        .eq('organization_id', activeOrg.id)
        .eq('is_active', true)
        .order('name', { ascending: true }),
    ]);

    if (unitsRes.error || methodsRes.error || hierarchyRes.error || conceptsRes.error) {
      setReferenceError('No se pudieron cargar las unidades, métodos de pago, prelación o conceptos. Intente nuevamente.');
      setLoadingReference(false);
      return;
    }

    setUnits((unitsRes.data || []) as Unit[]);
    setMethods((methodsRes.data || []) as PaymentMethod[]);
    setHierarchy((hierarchyRes.data || []) as PaymentHierarchyConfig[]);
    const allConcepts = (conceptsRes.data || []) as BillingConcept[];
    setConcepts(allConcepts);

    // Seleccionar por defecto el primer concepto que maneje anticipo si existe
    const firstAdvanceConcept = allConcepts.find(c => (c as any).advance_account_id);
    if (firstAdvanceConcept) {
      setSelectedAdvanceConceptId(firstAdvanceConcept.id);
    }

    setLoadingReference(false);
  }, [activeOrg]);

  useEffect(() => { loadReferenceData(); }, [loadReferenceData]);

  const loadPendingDues = useCallback(async (unitId: string) => {
    if (!activeOrg) return;
    const { data, error } = await supabase
      .from('dues')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .eq('unit_id', unitId)
      .in('status', ['pendiente', 'parcial'])
      .order('due_date', { ascending: true });

    if (error) {
      setDuesError('No se pudieron cargar las obligaciones pendientes de la unidad.');
      setDues([]);
      return;
    }
    setDuesError('');
    setDues((data || []) as Due[]);
  }, [activeOrg]);

  useEffect(() => {
    setDues([]);
    setOverrides(null);
    if (!header.unitId) return;
    setLoadingDues(true);
    loadPendingDues(header.unitId).finally(() => setLoadingDues(false));
  }, [header.unitId, loadPendingDues]);

  const totalNumber = parseAmount(header.total);
  const autoAllocation = useMemo(
    () => allocateReceipt(dues, hierarchy, totalNumber),
    [dues, hierarchy, totalNumber],
  );
  const inputs = overrides ?? toInputs(autoAllocation.amounts);

  const appliedTotal = roundMoney(dues.reduce(
    (sum, d) => sum + parseAmount(inputs[d.id]?.capital ?? '0') + parseAmount(inputs[d.id]?.interest ?? '0'),
    0,
  ));
  const advance = roundMoney(totalNumber - appliedTotal);
  const hasCapitalOverflow = dues.some(d => parseAmount(inputs[d.id]?.capital ?? '0') > d.balance);

  // Conceptos que manejan anticipo (tienen cuenta de anticipos parametrizada)
  const advanceEligibleConcepts = useMemo(() => {
    return concepts.filter(c => !c.is_late_interest && (c as any).advance_account_id);
  }, [concepts]);

  function updateHeader<K extends keyof HeaderState>(key: K, value: HeaderState[K]) {
    setHeader(prev => ({ ...prev, [key]: value }));
    setSuccessMessage('');
    setFormError('');
  }

  function handlePaymentDateChange(value: string) {
    setHeader(prev => ({
      ...prev,
      paymentDate: value,
      accountingDate: prev.accountingDate === prev.paymentDate ? value : prev.accountingDate,
    }));
  }

  function handleTotalChange(value: string) {
    updateHeader('total', value);
    setOverrides(null);
  }

  function handleAllocationChange(dueId: string, field: keyof AllocationInput, value: string) {
    setOverrides(prev => {
      const base = prev ?? toInputs(autoAllocation.amounts);
      return { ...base, [dueId]: { ...(base[dueId] ?? { capital: '0', interest: '0' }), [field]: value } };
    });
    setSuccessMessage('');
    setFormError('');
  }

  function resetAllocation() {
    setOverrides(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;

    if (!header.unitId) return setFormError('Seleccione la unidad que realiza el pago.');
    if (!header.paymentMethodId) return setFormError('Seleccione el método de pago.');
    if (!header.paymentDate || !header.accountingDate) return setFormError('Las fechas de pago y contable son obligatorias.');
    if (totalNumber <= 0) return setFormError('El valor recibido debe ser mayor a cero.');
    if (advance < 0) return setFormError(`Lo aplicado supera el valor recibido en ${formatCOP(Math.abs(advance))}.`);
    if (hasCapitalOverflow) return setFormError('Hay un valor a capital que supera el saldo pendiente de su obligación.');
    if (appliedTotal + (advance > 0 ? advance : 0) !== totalNumber) {
      setFormError('El valor recibido debe cuadrar exactamente con la suma del total aplicado y el anticipo.');
      return;
    }

    const allocations = dues
      .map(d => ({
        due_id: d.id,
        concept_id: autoAllocation.conceptId,
        capital_applied: parseAmount(inputs[d.id]?.capital ?? '0'),
        interest_applied: parseAmount(inputs[d.id]?.interest ?? '0'),
      }))
      .filter(a => a.capital_applied + a.interest_applied > 0);

    const unit = units.find(u => u.id === header.unitId);
    const method = methods.find(m => m.id === header.paymentMethodId);
    const printLines = dues
      .map(d => ({ due: d, capital: parseAmount(inputs[d.id]?.capital ?? '0'), interest: parseAmount(inputs[d.id]?.interest ?? '0') }))
      .filter(l => l.capital + l.interest > 0)
      .map(l => ({
        period: l.due.period,
        dueDate: l.due.due_date,
        capital: l.capital,
        interest: l.interest,
        balanceAfter: roundMoney(Math.max(l.due.balance - l.capital, 0)),
      }));

    setSaving(true);
    setFormError('');
    const { data, error } = await supabase.rpc('save_receipt', {
      p_organization_id: activeOrg.id,
      p_unit_id: header.unitId,
      p_payment_date: header.paymentDate,
      p_accounting_date: header.accountingDate,
      p_payment_method_id: header.paymentMethodId,
      p_total_amount: totalNumber,
      p_notes: header.notes,
      p_allocations: allocations,
      p_advance_concept_id: advance > 0 ? (selectedAdvanceConceptId || null) : null,
      p_advance_amount: advance > 0 ? advance : 0,
    });
    setSaving(false);

    const receiptNumber = (data as { receipt_number?: unknown } | null)?.receipt_number;
    if (error || typeof receiptNumber !== 'string') {
      setFormError(error?.message || 'No se pudo registrar el recibo. Intente nuevamente.');
      return;
    }

    setSuccessMessage(`Recibo ${receiptNumber} registrado correctamente.`);
    setPrintable({
      receiptNumber,
      organizationName: activeOrg.name,
      organizationNit: activeOrg.nit,
      unitLabel: unit ? unitLabel(unit) : '',
      ownerName: unit?.owner_name ?? '',
      paymentDate: header.paymentDate,
      accountingDate: header.accountingDate,
      methodName: method?.name ?? '',
      total: totalNumber,
      applied: appliedTotal,
      advance: Math.max(advance, 0),
      notes: header.notes,
      lines: printLines,
    });
    setHeader(prev => ({ ...prev, total: '', notes: '' }));
    setOverrides(null);
    await loadPendingDues(header.unitId);
  }

  if (!activeOrg) return <NoOrgSelected />;

  if (loadingReference) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>;
  }

  if (referenceError) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-600" />
        <p className="text-sm text-red-700">{referenceError}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <Card>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Select label="Unidad *" value={header.unitId} onChange={e => updateHeader('unitId', e.target.value)} required>
            <option value="">— Seleccionar unidad —</option>
            {units.map(u => <option key={u.id} value={u.id}>{unitLabel(u)}</option>)}
          </Select>
          <Select label="Método de pago *" value={header.paymentMethodId} onChange={e => updateHeader('paymentMethodId', e.target.value)} required>
            <option value="">— Seleccionar método —</option>
            {methods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          <Input label="Valor recibido *" type="number" min={0} step="0.01" value={header.total} onChange={e => handleTotalChange(e.target.value)} required />
          <Input label="Fecha de pago *" type="date" value={header.paymentDate} onChange={e => handlePaymentDateChange(e.target.value)} required />
          <Input label="Fecha contable *" type="date" value={header.accountingDate} onChange={e => updateHeader('accountingDate', e.target.value)} required />
          <TextArea label="Notas" rows={1} value={header.notes} onChange={e => updateHeader('notes', e.target.value)} placeholder="Ej: Consignación Bancolombia ref. 12345" />
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Gestión de Cobro y Aplicación</h2>
            <p className="text-sm text-gray-500">Revise las obligaciones pendientes y desglose la aplicación del pago.</p>
          </div>
          {header.unitId && dues.length > 0 && overrides && (
            <Button type="button" variant="outline" size="sm" onClick={resetAllocation}>
              <RotateCcw className="w-4 h-4" /> Recalcular automáticamente
            </Button>
          )}
        </div>

        {!header.unitId ? (
          <p className="text-center text-gray-500 py-12">Seleccione una unidad para ver sus obligaciones pendientes</p>
        ) : loadingDues ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : duesError ? (
          <p className="text-center text-red-600 py-12">{duesError}</p>
        ) : dues.length === 0 ? (
          <p className="text-center text-gray-500 py-12">Esta unidad no tiene obligaciones pendientes</p>
        ) : (
          <div className="p-6">
            <ReceiptAllocationTable dues={dues} inputs={inputs} onChange={handleAllocationChange} />
          </div>
        )}
      </Card>

      {/* Sección de Anticipos / Excedentes si aplica */}
      {advance > 0 && (
        <Card>
          <div className="p-6 space-y-4 bg-blue-50/50 rounded-lg border border-blue-100">
            <div>
              <h3 className="text-sm font-semibold text-blue-900">Asignación de Saldo a Favor / Anticipo Detectado</h3>
              <p className="text-xs text-blue-700">El valor recibido excede las obligaciones seleccionadas en {formatCOP(advance)}. Seleccione a qué concepto con cuenta de anticipos desea acreditar este excedente:</p>
            </div>
            <div className="max-w-md">
              <Select
                label="Concepto Destino del Anticipo *"
                value={selectedAdvanceConceptId}
                onChange={e => setSelectedAdvanceConceptId(e.target.value)}
                required
              >
                <option value="">— Seleccionar concepto con anticipo —</option>
                {advanceEligibleConcepts.map(c => (
                  <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                ))}
              </Select>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
            <p className="text-xs font-semibold text-gray-600 uppercase">Valor recibido</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{formatCOP(totalNumber)}</p>
          </div>
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
            <p className="text-xs font-semibold text-gray-600 uppercase">Total aplicado</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{formatCOP(appliedTotal)}</p>
          </div>
          <div className={`rounded-lg border px-4 py-3 ${advance < 0 ? 'bg-red-50 border-red-200' : advance > 0 ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
            <p className="text-xs font-semibold text-gray-600 uppercase">Anticipo / Saldo a Favor</p>
            <p className={`text-xl font-bold mt-1 ${advance < 0 ? 'text-red-700' : advance > 0 ? 'text-green-700' : 'text-gray-900'}`}>
              {formatCOP(Math.max(advance, 0))}
            </p>
            {advance < 0 && <p className="text-xs text-red-700 mt-1">Lo aplicado supera el valor recibido</p>}
          </div>
        </div>

        {(formError || successMessage) && (
          <div className="px-6 pb-4">
            {formError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <p className="text-sm text-red-700">{formError}</p>
              </div>
            )}
            {successMessage && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <p className="text-sm text-green-700">{successMessage}</p>
                </div>
                {printable && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setPrintOpen(true)}>
                    <Printer className="w-4 h-4" /> Ver e imprimir recibo
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end px-6 pb-6">
          <Button type="submit" disabled={saving || !header.unitId || dues.length === 0 || advance < 0 || (advance > 0 && !selectedAdvanceConceptId)}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Registrando...</> : 'Registrar recibo de caja'}
          </Button>
        </div>
      </Card>

      <Modal open={printOpen} onClose={() => setPrintOpen(false)} title="Recibo de caja" size="lg">
        {printable && <ReceiptPrintView receipt={printable} />}
        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="outline" onClick={() => setPrintOpen(false)}>Cerrar</Button>
          <Button type="button" onClick={() => window.print()}><Printer className="w-4 h-4" /> Imprimir o guardar PDF</Button>
        </div>
      </Modal>
    </form>
  );
}