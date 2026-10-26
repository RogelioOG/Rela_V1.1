import { useEffect, useState, useMemo } from 'react';
import { Loader2, Printer, FileText, Scale, TrendingUp, Info, BookOpen, Filter } from 'lucide-react';
import { supabase, Account, Due, Product, JournalEntry, JournalLine, ThirdParty } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, formatShortDate } from '@/lib/format';
import { accountTypeLabels } from '@/lib/format';

type ReportTab = 'resultados' | 'balance' | 'cartera' | 'libro' | 'prueba';

interface AccountBalance {
  code: string;
  name: string;
  balance: number;
  previousBalance?: number;
}

interface LibroMovement {
  date: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  referenceType: string;
}

interface DateFilter {
  from: string;
  to: string;
}

const emptyDateFilter: DateFilter = { from: '', to: '' };

export default function ReportesPage() {
  const { activeOrg } = useOrg();
  const [tab, setTab] = useState<ReportTab>('resultados');
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [dues, setDues] = useState<(Due & { units?: { unit_label: string } })[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [journalEntries, setJournalEntries] = useState<(JournalEntry & { journal_lines?: (JournalLine & { accounts?: Account })[] })[]>([]);
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([]);
  const [thirdPartiesLoading, setThirdPartiesLoading] = useState(false);

  // Independent date filters per tab
  const [dateFilters, setDateFilters] = useState<Record<ReportTab, DateFilter>>({
    resultados: { ...emptyDateFilter },
    balance: { ...emptyDateFilter },
    libro: { ...emptyDateFilter },
    prueba: { ...emptyDateFilter },
    cartera: { ...emptyDateFilter },
  });

  // Account + third-party filters (shared, only used by tabs that show them)
  const [filterAccount, setFilterAccount] = useState<string>('');
  const [filterThirdParty, setFilterThirdParty] = useState<string>('');

  const currentDateFilter = dateFilters[tab];

  function updateDateFilter(field: keyof DateFilter, value: string) {
    setDateFilters(prev => ({ ...prev, [tab]: { ...prev[tab], [field]: value } }));
  }

  function clearDateFilter() {
    setDateFilters(prev => ({ ...prev, [tab]: { ...emptyDateFilter } }));
  }

  useEffect(() => { if (activeOrg) loadData(); }, [activeOrg]);
  useEffect(() => { if (activeOrg && (tab === 'libro' || tab === 'prueba') && !thirdPartiesLoading && thirdParties.length === 0) loadThirdParties(); }, [activeOrg, tab]);

  async function loadData() {
    if (!activeOrg) return;
    setLoading(true);
    const [accsRes, duesRes, prodRes, jeRes] = await Promise.all([
      supabase.from('accounts').select('*').eq('organization_id', activeOrg.id).order('code'),
      supabase.from('dues').select('*, units(unit_label)').eq('organization_id', activeOrg.id).order('due_date', { ascending: false }),
      supabase.from('products').select('*').eq('organization_id', activeOrg.id),
      supabase.from('journal_entries').select('*, journal_lines(*, accounts(*))').eq('organization_id', activeOrg.id).order('date', { ascending: true }),
    ]);
    setAccounts(accsRes.data || []);
    setDues(duesRes.data || []);
    setProducts(prodRes.data || []);
    setJournalEntries(jeRes.data || []);
    setLoading(false);
  }

  async function loadThirdParties() {
    if (!activeOrg) return;
    setThirdPartiesLoading(true);
    const { data } = await supabase.from('third_parties').select('*').eq('organization_id', activeOrg.id).eq('is_active', true).order('name');
    setThirdParties(data || []);
    setThirdPartiesLoading(false);
  }

  if (!activeOrg) return <NoOrgSelected />;

  type FlatLine = JournalLine & {
    accounts?: Account;
    journal_date: string;
    journal_description: string;
    reference_type: string;
    reference_id: string | null;
  };

  const allLines: FlatLine[] = useMemo(() => {
    const lines: FlatLine[] = [];
    for (const je of journalEntries) {
      for (const jl of (je.journal_lines || [])) {
        lines.push({
          ...jl,
          journal_date: je.date,
          journal_description: je.description,
          reference_type: je.reference_type,
          reference_id: je.reference_id,
        });
      }
    }
    return lines;
  }, [journalEntries]);

  function dateInRange(dateStr: string, filter: DateFilter): boolean {
    if (filter.from && dateStr < filter.from) return false;
    if (filter.to && dateStr > filter.to) return false;
    return true;
  }

  function isBeforeFilter(dateStr: string, filter: DateFilter): boolean {
    if (filter.from && dateStr >= filter.from) return false;
    return true;
  }

  function accountMatches(accId: string): boolean {
    if (!filterAccount) return true;
    return accId === filterAccount;
  }

  function thirdPartyMatches(referenceId: string | null, referenceType: string): boolean {
    if (!filterThirdParty) return true;
    if (referenceType === 'invoice' && referenceId) return referenceId === filterThirdParty;
    return false;
  }

  // Build account totals for the current tab's date filter
  const accountTotals: Record<string, { debit: number; credit: number }> = {};
  for (const line of allLines) {
    if (!line.accounts) continue;
    if (!dateInRange(line.journal_date, currentDateFilter)) continue;
    if (filterThirdParty && !thirdPartyMatches(line.reference_id, line.reference_type)) continue;
    const accId = line.accounts.id;
    if (!accountTotals[accId]) accountTotals[accId] = { debit: 0, credit: 0 };
    accountTotals[accId].debit += line.debit;
    accountTotals[accId].credit += line.credit;
  }

  // Previous balances (before current tab's "from" date) for Balance de Prueba
  const previousTotals: Record<string, { debit: number; credit: number }> = {};
  if (currentDateFilter.from) {
    for (const line of allLines) {
      if (!line.accounts) continue;
      if (!isBeforeFilter(line.journal_date, currentDateFilter)) continue;
      const accId = line.accounts.id;
      if (!previousTotals[accId]) previousTotals[accId] = { debit: 0, credit: 0 };
      previousTotals[accId].debit += line.debit;
      previousTotals[accId].credit += line.credit;
    }
  }

  function isDebitNature(type: string): boolean {
    return type === 'activo' || type === 'gasto' || type === 'costo' || type === 'costo_ventas' || type === 'orden_deudora';
  }

  function getBalanceForAccount(acc: Account, totals = accountTotals): number {
    const t = totals[acc.id];
    if (!t) return 0;
    if (isDebitNature(acc.type)) return t.debit - t.credit;
    return t.credit - t.debit;
  }

  function getPreviousBalance(acc: Account): number {
    if (!currentDateFilter.from) return 0;
    return getBalanceForAccount(acc, previousTotals);
  }

  const inventoryValue = products.reduce((s, p) => s + p.stock * p.cost_price, 0);

  const ingresosAccounts = accounts.filter(a => a.type === 'ingreso');
  const gastosAccounts = accounts.filter(a => a.type === 'gasto');
  const costosAccounts = accounts.filter(a => a.type === 'costo');
  const costoVentasAccounts = accounts.filter(a => a.type === 'costo_ventas');
  const activosAccounts = accounts.filter(a => a.type === 'activo');
  const pasivosAccounts = accounts.filter(a => a.type === 'pasivo');
  const patrimonioAccounts = accounts.filter(a => a.type === 'patrimonio');

  const ingresoBalances: AccountBalance[] = ingresosAccounts.map(a => ({ code: a.code, name: a.name, balance: getBalanceForAccount(a) }));
  const gastoBalances: AccountBalance[] = gastosAccounts.map(a => ({ code: a.code, name: a.name, balance: getBalanceForAccount(a) }));
  const costoBalances: AccountBalance[] = costosAccounts.map(a => ({ code: a.code, name: a.name, balance: getBalanceForAccount(a) }));
  const costoVentasBalances: AccountBalance[] = costoVentasAccounts.map(a => ({ code: a.code, name: a.name, balance: getBalanceForAccount(a) }));
  const activoBalances: AccountBalance[] = activosAccounts.map(a => ({ code: a.code, name: a.name, balance: getBalanceForAccount(a) }));
  const pasivoBalances: AccountBalance[] = pasivosAccounts.map(a => ({ code: a.code, name: a.name, balance: getBalanceForAccount(a) }));
  const patrimonioBalances: AccountBalance[] = patrimonioAccounts.map(a => ({ code: a.code, name: a.name, balance: getBalanceForAccount(a) }));

  const totalIngresos = ingresoBalances.reduce((s, a) => s + a.balance, 0);
  const totalGastos = gastoBalances.reduce((s, a) => s + a.balance, 0);
  const totalCostos = costoBalances.reduce((s, a) => s + a.balance, 0);
  const totalCostoVentas = costoVentasBalances.reduce((s, a) => s + a.balance, 0);
  const totalActivos = activoBalances.reduce((s, a) => s + a.balance, 0);
  const totalPasivos = pasivoBalances.reduce((s, a) => s + a.balance, 0);
  const utilidad = totalIngresos - totalGastos - totalCostos - totalCostoVentas;
  const totalPatrimonio = patrimonioBalances.reduce((s, a) => s + a.balance, 0) + utilidad;

  const ordenDeudoraAccounts = accounts.filter(a => a.type === 'orden_deudora');
  const ordenAcreedoraAccounts = accounts.filter(a => a.type === 'orden_acreedora');
  const ordenDeudoraBalances: AccountBalance[] = ordenDeudoraAccounts.map(a => ({ code: a.code, name: a.name, balance: getBalanceForAccount(a) }));
  const ordenAcreedoraBalances: AccountBalance[] = ordenAcreedoraAccounts.map(a => ({ code: a.code, name: a.name, balance: getBalanceForAccount(a) }));
  const totalOrdenDeudora = ordenDeudoraBalances.reduce((s, a) => s + a.balance, 0);
  const totalOrdenAcreedora = ordenAcreedoraBalances.reduce((s, a) => s + a.balance, 0);

  // Libro Auxiliar
  const libroAccount = filterAccount ? accounts.find(a => a.id === filterAccount) : null;

  const libroMovements: LibroMovement[] = useMemo(() => {
    if (!libroAccount) return [];
    const movements: LibroMovement[] = [];
    let runningDebit = 0;
    let runningCredit = 0;
    const sorted = [...allLines]
      .filter(l => l.accounts && l.accounts.id === libroAccount.id)
      .filter(l => dateInRange(l.journal_date, currentDateFilter))
      .filter(l => !filterThirdParty || thirdPartyMatches(l.reference_id, l.reference_type))
      .sort((a, b) => a.journal_date.localeCompare(b.journal_date));

    for (const line of sorted) {
      runningDebit += line.debit;
      runningCredit += line.credit;
      const runningBalance = isDebitNature(libroAccount.type)
        ? runningDebit - runningCredit
        : runningCredit - runningDebit;
      movements.push({
        date: line.journal_date,
        description: line.journal_description,
        debit: line.debit,
        credit: line.credit,
        runningBalance,
        referenceType: line.reference_type,
      });
    }
    return movements;
  }, [allLines, libroAccount, currentDateFilter, filterThirdParty]);

  const libroInitialBalance = useMemo(() => {
    if (!libroAccount) return 0;
    let debit = 0;
    let credit = 0;
    for (const line of allLines) {
      if (!line.accounts || line.accounts.id !== libroAccount.id) continue;
      if (currentDateFilter.from && line.journal_date >= currentDateFilter.from) continue;
      debit += line.debit;
      credit += line.credit;
    }
    return isDebitNature(libroAccount.type) ? debit - credit : credit - debit;
  }, [allLines, libroAccount, currentDateFilter.from]);

  const libroFinalBalance = libroMovements.length > 0
    ? libroMovements[libroMovements.length - 1].runningBalance
    : libroInitialBalance;

  const libroTotalDebit = libroMovements.reduce((s, m) => s + m.debit, 0);
  const libroTotalCredit = libroMovements.reduce((s, m) => s + m.credit, 0);

  // Balance de Prueba with Saldo Anterior and Saldo Actual
  const pruebaAccounts: AccountBalance[] = useMemo(() => {
    if (filterAccount) {
      const acc = accounts.find(a => a.id === filterAccount);
      if (!acc) return [];
      return [{ code: acc.code, name: acc.name, balance: getBalanceForAccount(acc), previousBalance: getPreviousBalance(acc) }];
    }
    return accounts
      .filter(a => a.is_active)
      .map(a => ({ code: a.code, name: a.name, balance: getBalanceForAccount(a), previousBalance: getPreviousBalance(a) }))
      .filter(a => a.balance !== 0 || a.previousBalance !== 0)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [accounts, filterAccount, accountTotals, previousTotals, currentDateFilter]);

  const accountByCode: Record<string, Account> = {};
  for (const acc of accounts) accountByCode[acc.code] = acc;

  const pruebaTotalPrevDebit = pruebaAccounts.reduce((s, a) => {
    const acc = accountByCode[a.code];
    if (!acc || !isDebitNature(acc.type)) return s;
    return s + Math.abs(a.previousBalance || 0);
  }, 0);
  const pruebaTotalPrevCredit = pruebaAccounts.reduce((s, a) => {
    const acc = accountByCode[a.code];
    if (!acc || isDebitNature(acc.type)) return s;
    return s + Math.abs(a.previousBalance || 0);
  }, 0);
  const pruebaTotalDebit = pruebaAccounts.reduce((s, a) => {
    const acc = accountByCode[a.code];
    if (!acc || !isDebitNature(acc.type)) return s;
    return s + Math.abs(a.balance);
  }, 0);
  const pruebaTotalCredit = pruebaAccounts.reduce((s, a) => {
    const acc = accountByCode[a.code];
    if (!acc || isDebitNature(acc.type)) return s;
    return s + Math.abs(a.balance);
  }, 0);

  // Cartera
  const today = new Date();
  const buckets = { corrientes: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const bucketLabels: Record<string, string> = {
    'corrientes': 'Al día (Corrientes)', '1-30': '1 a 30 días', '31-60': '31 a 60 días', '61-90': '61 a 90 días', '90+': 'Más de 90 días',
  };
  const carteraDetails: (Due & { units?: { unit_label: string } })[] = [];
  for (const due of dues) {
    if (due.status === 'pagada' || due.status === 'anulada') continue;
    const daysLate = Math.max(0, Math.floor((today.getTime() - new Date(due.due_date).getTime()) / (1000 * 60 * 60 * 24)));
    if (daysLate === 0) buckets.corrientes += due.balance;
    else if (daysLate <= 30) buckets['1-30'] += due.balance;
    else if (daysLate <= 60) buckets['31-60'] += due.balance;
    else if (daysLate <= 90) buckets['61-90'] += due.balance;
    else buckets['90+'] += due.balance;
    carteraDetails.push(due);
  }
  const totalCartera = Object.values(buckets).reduce((s, v) => s + v, 0);

  function handlePrint() { window.print(); }

  const tabs: { id: ReportTab; label: string; icon: typeof FileText }[] = [
    { id: 'resultados', label: 'Estado de Resultados', icon: TrendingUp },
    { id: 'balance', label: 'Estado de Situación Financiera', icon: Scale },
    { id: 'libro', label: 'Libro Auxiliar Contable', icon: BookOpen },
    { id: 'prueba', label: 'Balance de Prueba', icon: FileText },
    { id: 'cartera', label: 'Cartera por Edades', icon: FileText },
  ];

  const hasRealData = journalEntries.length > 0 || products.length > 0;

  function renderAccountRows(balances: AccountBalance[]) {
    const nonZero = balances.filter(a => a.balance !== 0);
    if (balances.length === 0) return <tr><td className="px-6 py-2 text-sm text-gray-400">Sin cuentas configuradas</td><td></td></tr>;
    if (nonZero.length === 0) return <tr><td className="px-6 py-2 text-sm text-gray-400">Sin movimientos registrados</td><td className="px-6 py-2 text-right text-sm text-gray-400">{formatCOP(0)}</td></tr>;
    return nonZero.map((a, i) => (
      <tr key={i} className="border-b border-gray-50"><td className="px-12 py-2 text-sm text-gray-700">{a.code} — {a.name}</td><td className="px-6 py-2 text-right text-sm text-gray-900">{formatCOP(a.balance)}</td></tr>
    ));
  }

  function FiltersBar({ showAccount = true, showThirdParty = false, showDate = true }: { showAccount?: boolean; showThirdParty?: boolean; showDate?: boolean }) {
    return (
      <div className="flex flex-wrap gap-3 items-end bg-gray-50 px-6 py-3 border-b border-gray-200 print:hidden">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700"><Filter className="w-4 h-4" /> Filtros</div>
        {showAccount && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Cuenta</label>
            <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]">
              <option value="">Todas las cuentas</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </div>
        )}
        {showThirdParty && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tercero</label>
            <select value={filterThirdParty} onChange={(e) => setFilterThirdParty(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]">
              <option value="">Todos los terceros</option>
              {thirdParties.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        {showDate && (
          <>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Desde</label>
              <input type="date" value={currentDateFilter.from} onChange={(e) => updateDateFilter('from', e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hasta</label>
              <input type="date" value={currentDateFilter.to} onChange={(e) => updateDateFilter('to', e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </>
        )}
        {(filterAccount || filterThirdParty || currentDateFilter.from || currentDateFilter.to) && (
          <Button size="sm" variant="outline" onClick={() => { setFilterAccount(''); setFilterThirdParty(''); clearDateFilter(); }}>Limpiar</Button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reportes Financieros</h1>
          <p className="text-gray-500 mt-1">Reportes contables con filtros independientes por reporte</p>
        </div>
        <Button variant="outline" onClick={handlePrint}><Printer className="w-4 h-4" /> Imprimir</Button>
      </div>

      <div className="flex gap-2 mb-5 print:hidden flex-wrap">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${tab === t.id ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
      ) : !hasRealData && accounts.length === 0 ? (
        <Card><CardBody className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Info className="w-8 h-8 text-gray-400" /></div>
          <p className="text-gray-500">No hay transacciones registradas ni plan de cuentas configurado.</p>
          <p className="text-sm text-gray-400 mt-1">Registre ventas, recaudos o configure el plan de cuentas para ver reportes.</p>
        </CardBody></Card>
      ) : (
        <div className="print-area space-y-4">
          <div className="hidden print:block mb-6">
            <h1 className="text-2xl font-bold">Rela ERP — Reportes Financieros</h1>
            <p className="text-sm text-gray-600">Organización: {activeOrg.name} · Fecha: {formatShortDate(new Date().toISOString())}</p>
          </div>

          {tab === 'resultados' && (
            <Card>
              <FiltersBar showDate={true} showAccount={false} />
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Estado de Resultados (P&G)</h3>
                <p className="text-sm text-gray-500">
                  {activeOrg.name}
                  {currentDateFilter.from && ` · Desde ${formatShortDate(currentDateFilter.from)}`}
                  {currentDateFilter.to && ` · Hasta ${formatShortDate(currentDateFilter.to)}`}
                </p>
              </div>
              <CardBody className="p-0">
                <table className="w-full">
                  <tbody>
                    <tr className="border-b border-gray-100 bg-green-50"><td colSpan={2} className="px-6 py-2 text-sm font-semibold text-green-800">INGRESOS</td></tr>
                    {renderAccountRows(ingresoBalances)}
                    <tr className="border-b border-gray-200"><td className="px-6 py-2 text-sm font-semibold text-gray-900">Total Ingresos</td><td className="px-6 py-2 text-right text-sm font-bold text-green-600">{formatCOP(totalIngresos)}</td></tr>
                    <tr className="border-b border-gray-100 bg-red-50"><td colSpan={2} className="px-6 py-2 text-sm font-semibold text-red-800">GASTOS</td></tr>
                    {renderAccountRows(gastoBalances)}
                    <tr className="border-b border-gray-200"><td className="px-6 py-2 text-sm font-semibold text-gray-900">Total Gastos</td><td className="px-6 py-2 text-right text-sm font-bold text-red-600">{formatCOP(totalGastos)}</td></tr>
                    {costoBalances.length > 0 && (
                      <>
                        <tr className="border-b border-gray-100 bg-orange-50"><td colSpan={2} className="px-6 py-2 text-sm font-semibold text-orange-800">COSTOS DE PRODUCCIÓN (CLASE 7)</td></tr>
                        {renderAccountRows(costoBalances)}
                        <tr className="border-b border-gray-200"><td className="px-6 py-2 text-sm font-semibold text-gray-900">Total Costos de Producción</td><td className="px-6 py-2 text-right text-sm font-bold text-orange-600">{formatCOP(totalCostos)}</td></tr>
                      </>
                    )}
                    {costoVentasBalances.length > 0 && (
                      <>
                        <tr className="border-b border-gray-100 bg-amber-50"><td colSpan={2} className="px-6 py-2 text-sm font-semibold text-amber-800">COSTO DE VENTAS (CLASE 6)</td></tr>
                        {renderAccountRows(costoVentasBalances)}
                        <tr className="border-b border-gray-200"><td className="px-6 py-2 text-sm font-semibold text-gray-900">Total Costo de Ventas</td><td className="px-6 py-2 text-right text-sm font-bold text-amber-600">{formatCOP(totalCostoVentas)}</td></tr>
                      </>
                    )}
                    <tr className="bg-gray-50"><td className="px-6 py-3 text-base font-bold text-gray-900">{utilidad >= 0 ? 'UTILIDAD NETA' : 'PÉRDIDA NETA'}</td><td className={`px-6 py-3 text-right text-base font-bold ${utilidad >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCOP(utilidad)}</td></tr>
                  </tbody>
                </table>
                <div className="px-6 py-3 bg-blue-50 border-t border-blue-100">
                  <p className="text-xs text-blue-600">Los saldos se acumulan automáticamente desde los débitos y créditos de los asientos contables.</p>
                </div>
              </CardBody>
            </Card>
          )}

          {tab === 'balance' && (
            <Card>
              <FiltersBar showDate={true} showAccount={false} />
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Estado de Situación Financiera</h3>
                <p className="text-sm text-gray-500">
                  {activeOrg.name}
                  {currentDateFilter.from && ` · Desde ${formatShortDate(currentDateFilter.from)}`}
                  {currentDateFilter.to && ` · Hasta ${formatShortDate(currentDateFilter.to)}`}
                </p>
              </div>
              <CardBody className="p-0">
                <table className="w-full">
                  <tbody>
                    <tr className="border-b border-gray-100 bg-blue-50"><td colSpan={2} className="px-6 py-2 text-sm font-semibold text-blue-800">ACTIVOS</td></tr>
                    {activoBalances.length === 0 ? <tr><td className="px-6 py-2 text-sm text-gray-400">Sin cuentas de activo configuradas</td><td></td></tr> :
                      activoBalances.filter(a => a.balance !== 0).map((a, i) => <tr key={i} className="border-b border-gray-50"><td className="px-12 py-2 text-sm text-gray-700">{a.code} — {a.name}</td><td className="px-6 py-2 text-right text-sm text-gray-900">{formatCOP(a.balance)}</td></tr>)}
                    <tr className="border-b border-gray-200"><td className="px-6 py-2 text-sm font-semibold text-gray-900">Total Activos</td><td className="px-6 py-2 text-right text-sm font-bold text-blue-600">{formatCOP(totalActivos)}</td></tr>
                    <tr className="border-b border-gray-100 bg-yellow-50"><td colSpan={2} className="px-6 py-2 text-sm font-semibold text-yellow-800">PASIVOS</td></tr>
                    {pasivoBalances.length === 0 ? <tr><td className="px-6 py-2 text-sm text-gray-400">Sin cuentas de pasivo configuradas</td><td></td></tr> :
                      pasivoBalances.filter(a => a.balance !== 0).map((a, i) => <tr key={i} className="border-b border-gray-50"><td className="px-12 py-2 text-sm text-gray-700">{a.code} — {a.name}</td><td className="px-6 py-2 text-right text-sm text-gray-900">{formatCOP(a.balance)}</td></tr>)}
                    <tr className="border-b border-gray-200"><td className="px-6 py-2 text-sm font-semibold text-gray-900">Total Pasivos</td><td className="px-6 py-2 text-right text-sm font-bold text-yellow-600">{formatCOP(totalPasivos)}</td></tr>
                    <tr className="border-b border-gray-100 bg-green-50"><td colSpan={2} className="px-6 py-2 text-sm font-semibold text-green-800">PATRIMONIO</td></tr>
                    {patrimonioBalances.filter(a => a.balance !== 0).map((a, i) => <tr key={i} className="border-b border-gray-50"><td className="px-12 py-2 text-sm text-gray-700">{a.code} — {a.name}</td><td className="px-6 py-2 text-right text-sm text-gray-900">{formatCOP(a.balance)}</td></tr>)}
                    {utilidad !== 0 && <tr className="border-b border-gray-50"><td className="px-12 py-2 text-sm text-gray-700">Utilidad del Periodo</td><td className="px-6 py-2 text-right text-sm text-gray-900">{formatCOP(utilidad)}</td></tr>}
                    <tr className="border-b border-gray-200"><td className="px-6 py-2 text-sm font-semibold text-gray-900">Total Patrimonio</td><td className="px-6 py-2 text-right text-sm font-bold text-green-600">{formatCOP(totalPatrimonio)}</td></tr>
                    <tr className="bg-gray-50"><td className="px-6 py-3 text-base font-bold text-gray-900">Total Pasivos + Patrimonio</td><td className="px-6 py-3 text-right text-base font-bold text-gray-900">{formatCOP(totalPasivos + totalPatrimonio)}</td></tr>
                    {(totalOrdenDeudora !== 0 || totalOrdenAcreedora !== 0) && (
                      <>
                        <tr className="border-b border-gray-100 bg-gray-100"><td colSpan={2} className="px-6 py-2 text-sm font-semibold text-gray-700">CUENTAS DE ORDEN (CLASES 8 Y 9)</td></tr>
                        {ordenDeudoraBalances.filter(a => a.balance !== 0).map((a, i) => <tr key={`od${i}`} className="border-b border-gray-50"><td className="px-12 py-2 text-sm text-gray-600">{a.code} — {a.name}</td><td className="px-6 py-2 text-right text-sm text-gray-600">{formatCOP(a.balance)}</td></tr>)}
                        {ordenAcreedoraBalances.filter(a => a.balance !== 0).map((a, i) => <tr key={`oa${i}`} className="border-b border-gray-50"><td className="px-12 py-2 text-sm text-gray-600">{a.code} — {a.name}</td><td className="px-6 py-2 text-right text-sm text-gray-600">{formatCOP(a.balance)}</td></tr>)}
                        <tr className="border-b border-gray-200"><td className="px-6 py-2 text-sm font-semibold text-gray-700">Total Orden Deudora</td><td className="px-6 py-2 text-right text-sm font-bold text-gray-700">{formatCOP(totalOrdenDeudora)}</td></tr>
                        <tr className="border-b border-gray-200"><td className="px-6 py-2 text-sm font-semibold text-gray-700">Total Orden Acreedora</td><td className="px-6 py-2 text-right text-sm font-bold text-gray-700">{formatCOP(totalOrdenAcreedora)}</td></tr>
                      </>
                    )}
                  </tbody>
                </table>
                <div className="px-6 py-3 bg-blue-50 border-t border-blue-100">
                  <p className="text-xs text-blue-600">Inventario valorado a costo: {formatCOP(inventoryValue)}. Los saldos se acumulan de débitos y créditos por naturaleza de cuenta.</p>
                </div>
              </CardBody>
            </Card>
          )}

          {tab === 'libro' && (
            <Card>
              <FiltersBar showAccount={true} showThirdParty={true} showDate={true} />
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Libro Auxiliar Contable</h3>
                <p className="text-sm text-gray-500">
                  {libroAccount ? `${libroAccount.code} — ${libroAccount.name}` : 'Seleccione una cuenta para ver el detalle'}
                  {currentDateFilter.from && ` · Desde ${formatShortDate(currentDateFilter.from)}`}
                  {currentDateFilter.to && ` · Hasta ${formatShortDate(currentDateFilter.to)}`}
                </p>
              </div>
              <CardBody className="p-0">
                {!libroAccount ? (
                  <div className="text-center py-12">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><BookOpen className="w-8 h-8 text-gray-400" /></div>
                    <p className="text-gray-500">Use el filtro de cuenta para seleccionar una cuenta y ver sus movimientos detallados.</p>
                  </div>
                ) : libroMovements.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500">No hay movimientos para esta cuenta en el rango seleccionado.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead><tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Fecha</th>
                        <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Descripción</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Débito</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Crédito</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Saldo</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        <tr className="bg-gray-50">
                          <td className="px-6 py-2 text-sm text-gray-500 italic" colSpan={2}>Saldo inicial</td>
                          <td className="px-6 py-2"></td>
                          <td className="px-6 py-2"></td>
                          <td className="px-6 py-2 text-right text-sm font-medium text-gray-700">{formatCOP(libroInitialBalance)}</td>
                        </tr>
                        {libroMovements.map((m, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-6 py-2 text-sm text-gray-900">{formatShortDate(m.date)}</td>
                            <td className="px-6 py-2 text-sm text-gray-700">{m.description || '-'}</td>
                            <td className="px-6 py-2 text-right text-sm text-gray-900">{m.debit > 0 ? formatCOP(m.debit) : '-'}</td>
                            <td className="px-6 py-2 text-right text-sm text-gray-900">{m.credit > 0 ? formatCOP(m.credit) : '-'}</td>
                            <td className="px-6 py-2 text-right text-sm font-medium text-gray-900">{formatCOP(m.runningBalance)}</td>
                          </tr>
                        ))}
                        <tr className="bg-gray-100 border-t-2 border-gray-300">
                          <td className="px-6 py-3 text-sm font-bold text-gray-900" colSpan={2}>Totales del Periodo</td>
                          <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">{formatCOP(libroTotalDebit)}</td>
                          <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">{formatCOP(libroTotalCredit)}</td>
                          <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">{formatCOP(libroFinalBalance)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {tab === 'prueba' && (
            <Card>
              <FiltersBar showAccount={true} showThirdParty={false} showDate={true} />
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Balance de Prueba</h3>
                <p className="text-sm text-gray-500">
                  {filterAccount ? 'Cuenta individual' : 'Todas las cuentas con movimientos'}
                  {currentDateFilter.from && ` · Desde ${formatShortDate(currentDateFilter.from)}`}
                  {currentDateFilter.to && ` · Hasta ${formatShortDate(currentDateFilter.to)}`}
                </p>
              </div>
              <CardBody className="p-0">
                {pruebaAccounts.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><FileText className="w-8 h-8 text-gray-400" /></div>
                    <p className="text-gray-500">No hay cuentas con movimientos en el rango seleccionado.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead><tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Código</th>
                        <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Cuenta</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Saldo Anterior</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Mov. Débito</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Mov. Crédito</th>
                        <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Saldo Actual</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {pruebaAccounts.map((a, i) => {
                          const acc = accountByCode[a.code];
                          const isDebit = acc && isDebitNature(acc.type);
                          const prevBal = a.previousBalance || 0;
                          const currentBal = a.balance;
                          const movDebit = currentBal - prevBal;
                          return (
                            <tr key={i} className="hover:bg-gray-50">
                              <td className="px-6 py-2 text-sm font-mono text-gray-900">{a.code}</td>
                              <td className="px-6 py-2 text-sm font-medium text-gray-900">{a.name}</td>
                              <td className="px-6 py-2 text-right text-sm text-gray-700">{prevBal !== 0 ? formatCOP(Math.abs(prevBal)) : '-'}</td>
                              <td className="px-6 py-2 text-right text-sm text-gray-700 hidden md:table-cell">{isDebit && movDebit > 0 ? formatCOP(Math.abs(movDebit)) : '-'}</td>
                              <td className="px-6 py-2 text-right text-sm text-gray-700 hidden md:table-cell">{!isDebit && movDebit < 0 ? formatCOP(Math.abs(movDebit)) : '-'}</td>
                              <td className="px-6 py-2 text-right text-sm font-medium text-gray-900">{currentBal !== 0 ? formatCOP(Math.abs(currentBal)) : '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-100 border-t-2 border-gray-300">
                          <td className="px-6 py-3 text-sm font-bold text-gray-900" colSpan={2}>Totales</td>
                          <td className="px-6 py-3 text-right text-sm font-bold text-gray-700">{formatCOP(pruebaTotalPrevDebit + pruebaTotalPrevCredit)}</td>
                          <td className="px-6 py-3 text-right text-sm font-bold text-gray-900 hidden md:table-cell">{formatCOP(pruebaTotalPrevDebit)}</td>
                          <td className="px-6 py-3 text-right text-sm font-bold text-gray-900 hidden md:table-cell">{formatCOP(pruebaTotalPrevCredit)}</td>
                          <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">{formatCOP(pruebaTotalDebit + pruebaTotalCredit)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
                <div className="px-6 py-3 bg-blue-50 border-t border-blue-100">
                  <p className="text-xs text-blue-600">Saldo Anterior = saldo antes de la fecha "Desde". Saldo Actual = saldo final incluyendo movimientos del rango. Use el filtro de fechas para ver la variación entre periodos.</p>
                </div>
              </CardBody>
            </Card>
          )}

          {tab === 'cartera' && (
            <Card>
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Reporte de Cartera por Edades</h3>
                <p className="text-sm text-gray-500">{activeOrg.name}</p>
              </div>
              <CardBody className="p-0">
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Rango de Mora</th>
                    <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Saldo</th>
                    <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">% del Total</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(buckets).map(([key, value]) => (
                      <tr key={key} className="hover:bg-gray-50">
                        <td className="px-6 py-3 text-sm text-gray-900">{bucketLabels[key]}</td>
                        <td className="px-6 py-3 text-right text-sm font-medium text-gray-900">{formatCOP(value)}</td>
                        <td className="px-6 py-3 text-right text-sm text-gray-500 hidden md:table-cell">{totalCartera > 0 ? ((value / totalCartera) * 100).toFixed(1) + '%' : '0%'}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50"><td className="px-6 py-3 text-sm font-bold text-gray-900">Total Cartera</td><td className="px-6 py-3 text-right text-sm font-bold text-red-600">{formatCOP(totalCartera)}</td><td className="px-6 py-3 text-right text-sm font-bold hidden md:table-cell">100%</td></tr>
                  </tbody>
                </table>
                {carteraDetails.length > 0 && (
                  <div className="mt-4 px-6 pb-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">Detalle de Cuotas Pendientes</h4>
                    <table className="w-full text-xs">
                      <thead><tr className="text-gray-500 border-b border-gray-200">
                        <th className="text-left py-1">Unidad</th><th className="text-left py-1">Periodo</th><th className="text-left py-1">Vencimiento</th><th className="text-right py-1">Saldo</th>
                      </tr></thead>
                      <tbody>
                        {carteraDetails.slice(0, 20).map(d => (
                          <tr key={d.id} className="border-b border-gray-50">
                            <td className="py-1 text-gray-700">{d.units?.unit_label || 'N/A'}</td>
                            <td className="py-1 text-gray-700">{d.period}</td>
                            <td className="py-1 text-gray-700">{formatShortDate(d.due_date)}</td>
                            <td className="py-1 text-right text-gray-900">{formatCOP(d.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {carteraDetails.length > 20 && <p className="text-xs text-gray-400 mt-2">Mostrando 20 de {carteraDetails.length} cuotas pendientes</p>}
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
