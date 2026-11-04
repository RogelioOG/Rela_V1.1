import { useState, useEffect, useMemo } from 'react';
import { 
  Building2, Percent, Tag, FileText, CheckCircle2, ChevronRight, 
  Loader2, AlertCircle, RefreshCw 
} from 'lucide-react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { 
  supabase, Unit, Due, PaymentAgreement, DiscountTier, BillingConcept 
} from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

import Paso2FormatoEnvio, { LiquidationRow, ChargeLine } from './Paso2FormatoEnvio';

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export default function ProcesoFacturacion() {
  const { currentOrg } = useOrganization();
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);

  // Estados de carga y datos principales
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Parámetros de facturación
  const [billingPeriod, setBillingPeriod] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const [interestRate, setInterestRate] = useState<number>(1.5); // Tasa mensual por defecto %
  const [applyInterests, setApplyInterests] = useState<boolean>(true);

  // Tablas base de Supabase
  const [units, setUnits] = useState<Unit[]>([]);
  const [concepts, setConcepts] = useState<BillingConcept[]>([]);
  const [previousDues, setPreviousDues] = useState<Due[]>([]);
  const [agreements, setAgreements] = useState<PaymentAgreement[]>([]);
  const [discountTiers, setDiscountTiers] = useState<DiscountTier[]>([]);

  // Cargar todos los datos iniciales necesarios
  useEffect(() => {
    async function loadBillingData() {
      if (!currentOrg) return;
      setLoading(true);
      setError('');

      try {
        const [
          { data: unitsData, error: unitsErr },
          { data: conceptsData, error: conceptsErr },
          { data: duesData, error: duesErr },
          { data: agreementsData, error: agreementsErr },
          { data: tiersData, error: tiersErr }
        ] = await Promise.all([
          supabase.from('units').select('*').eq('organization_id', currentOrg.id).order('tower').order('unit_number'),
          supabase.from('billing_concepts').select('*').eq('organization_id', currentOrg.id).eq('is_active', true),
          supabase.from('dues').select('*').eq('organization_id', currentOrg.id).neq('status', 'pagado'),
          supabase.from('payment_agreements').select('*').eq('organization_id', currentOrg.id).eq('status', 'activo'),
          supabase.from('discount_tiers').select('*').eq('organization_id', currentOrg.id).eq('is_active', true).order('valid_until_day')
        ]);

        if (unitsErr) throw unitsErr;
        if (conceptsErr) throw conceptsErr;
        if (duesErr) throw duesErr;
        if (agreementsErr) throw agreementsErr;
        if (tiersErr) throw tiersErr;

        setUnits(unitsData || []);
        setConcepts(conceptsData || []);
        setPreviousDues(duesData || []);
        setAgreements(agreementsData || []);
        setDiscountTiers(tiersData || []);
      } catch (err: any) {
        console.error('Error al cargar datos de facturación:', err);
        setError('No se pudieron cargar los datos para la facturación. Por favor reintente.');
      } finally {
        setLoading(false);
      }
    }

    loadBillingData();
  }, [currentOrg]);

  // CALCULO COMPLETO Y DEPURADO DE LA LIQUIDACIÓN POR CADA INMUEBLE
  const liquidation: LiquidationRow[] = useMemo(() => {
    if (!units.length) return [];

    // Concepto base de administración
    const adminConcept = concepts.find(c => c.is_quota || c.code === 'ADM' || c.name.toLowerCase().includes('administración'));

    return units.map(unit => {
      // 1. Saldo Anterior (deudas en el módulo dues anteriores al periodo actual)
      const unitDues = previousDues.filter(d => d.unit_id === unit.id && d.period !== billingPeriod);
      const priorBalance = round2(unitDues.reduce((sum, d) => sum + (Number(d.balance) || Number(d.amount) || 0), 0));

      // 2. Cargos del Periodo Actual (Cuota fija del inmueble o valor del concepto)
      const baseQuota = Number(unit.custom_quota) || Number(adminConcept?.default_amount) || 250000;
      
      const chargeLines: ChargeLine[] = [
        {
          conceptId: adminConcept?.id || 'admin-base',
          conceptName: adminConcept?.name || 'Cuota de Administración',
          conceptCode: adminConcept?.code || 'ADM',
          amount: baseQuota,
          isQuota: true,
          isNovelty: false,
        }
      ];

      const currentCharges = round2(chargeLines.reduce((s, l) => s + l.amount, 0));

      // 3. Interés de Mora (Calculado sobre el Saldo Anterior si aplica)
      let interestAmount = 0;
      let daysLate = 0;

      if (applyInterests && priorBalance > 0 && interestRate > 0) {
        interestAmount = round2(priorBalance * (interestRate / 100));
        daysLate = 30; // Indicador predeterminado de mora de mes vencido
      }

      // 4. Totales Consolidados
      const netTotal = round2(priorBalance + currentCharges + interestAmount);

      return {
        rowId: unit.id,
        unit,
        daysLate,
        interestRate: applyInterests ? interestRate : 0,
        priorBalance,
        currentCharges,
        chargeLines,
        interestAmount,
        discountAmount: 0,
        netTotal,
        totalWithInterest: netTotal,
        baseAmount: currentCharges,
      };
    });
  }, [units, concepts, previousDues, billingPeriod, applyInterests, interestRate]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-sm text-gray-600">Cargando información y saldos de la copropiedad...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Encabezado del Proceso */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Proceso de Facturación</h1>
        <p className="text-sm text-gray-500 mt-1">Generación de facturación con cuotas, novedades, intereses de mora y descuentos.</p>
      </div>

      {/* Stepper / Indicador de Pasos */}
      <div className="flex items-center gap-3 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <button
          onClick={() => setCurrentStep(1)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            currentStep === 1 
              ? 'bg-blue-50 text-blue-700 border border-blue-200' 
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold ${
            currentStep === 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
          }`}>1</span>
          Parámetros de Liquidación
        </button>

        <ChevronRight className="w-4 h-4 text-gray-400" />

        <button
          onClick={() => setCurrentStep(2)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            currentStep === 2 
              ? 'bg-blue-50 text-blue-700 border border-blue-200' 
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold ${
            currentStep === 2 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
          }`}>2</span>
          Formatos y Envío
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex items-center gap-3 text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* PASO 1: PARÁMETROS GENERALES DE LA FACTURACIÓN */}
      {currentStep === 1 && (
        <div className="space-y-6">
          <Card>
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                Configuración del Periodo a Facturar
              </h2>
            </div>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Periodo a Liquidar *</label>
                  <input
                    type="month"
                    value={billingPeriod}
                    onChange={(e) => setBillingPeriod(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tasa Interés Mora Mensual (%)</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="10"
                      value={interestRate}
                      onChange={(e) => setInterestRate(parseFloat(e.target.value) || 0)}
                      disabled={!applyInterests}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 pr-8 disabled:bg-gray-100"
                    />
                    <Percent className="w-4 h-4 text-gray-400 absolute right-3 top-2.5" />
                  </div>
                </div>

                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={applyInterests}
                      onChange={(e) => setApplyInterests(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">Calcular Intereses sobre Saldo Anterior</span>
                  </label>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Resumen de Pre-liquidación */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                Resumen de Pre-liquidación ({liquidation.length} Inmuebles)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600 uppercase">
                    <th className="text-left px-4 py-3">Inmueble</th>
                    <th className="text-right px-4 py-3">Saldo Anterior</th>
                    <th className="text-right px-4 py-3">Cargos Mes</th>
                    <th className="text-right px-4 py-3">Int. Mora</th>
                    <th className="text-right px-4 py-3">Total Bruto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {liquidation.map(row => (
                    <tr key={row.rowId} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {row.unit.tower} {row.unit.unit_label}
                        <span className="block text-xs text-gray-500">{row.unit.owner_name}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-red-600 font-medium">
                        ${row.priorBalance.toLocaleString('es-CO')}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        ${row.currentCharges.toLocaleString('es-CO')}
                      </td>
                      <td className="px-4 py-3 text-right text-amber-600 font-medium">
                        ${row.interestAmount.toLocaleString('es-CO')}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-blue-900">
                        ${row.netTotal.toLocaleString('es-CO')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button onClick={() => setCurrentStep(2)}>
              Siguiente: Formatos y Envío <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* PASO 2: VISTA Y GENERACIÓN DE FORMATOS */}
      {currentStep === 2 && (
        <Paso2FormatoEnvio
          liquidation={liquidation}
          agreements={agreements}
          org={currentOrg}
          billingPeriod={billingPeriod}
          discountTiers={discountTiers}
          onBack={() => setCurrentStep(1)}
        />
      )}
    </div>
  );
}