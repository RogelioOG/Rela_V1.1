import { useEffect, useState } from 'react';
import { Building2, Users, Store, Home, TrendingUp, ShoppingCart, Wallet, FileText, Landmark, Calendar, Database, Layers, Percent, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrganizationContext';
import { supabase, Organization, Profile } from '@/lib/supabase';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { roleLabels, organizationTypes, formatDateTime, formatCOP, isCommercial, isPH } from '@/lib/format';

interface PeriodStats {
  invoices: number;
  revenue: number;
  cashIn: number;
  cashOut: number;
  cashBalance: number;
}

interface CumulativeStats {
  invoices: number;
  revenue: number;
  cashIn: number;
  cashOut: number;
  cashBalance: number;
  products: number;
  pendingDues: number;
  units: number;
}

const emptyPeriod: PeriodStats = { invoices: 0, revenue: 0, cashIn: 0, cashOut: 0, cashBalance: 0 };
const emptyCumulative: CumulativeStats = { invoices: 0, revenue: 0, cashIn: 0, cashOut: 0, cashBalance: 0, products: 0, pendingDues: 0, units: 0 };

function monthRange(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = `${y}-${pad(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${pad(m)}-${pad(lastDay)}`;
  return { start, end };
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const { activeOrg, isOrgAdmin } = useOrg();
  const [loading, setLoading] = useState(true);

  // Master stats
  const [orgCount, setOrgCount] = useState(0);
  const [userCount, setUserCount] = useState(0);
  const [activeOrgs, setActiveOrgs] = useState(0);
  const [recentOrgs, setRecentOrgs] = useState<Organization[]>([]);
  const [recentUsers, setRecentUsers] = useState<Profile[]>([]);

  // Org stats
  const [monthStats, setMonthStats] = useState<PeriodStats>(emptyPeriod);
  const [cumulative, setCumulative] = useState<CumulativeStats>(emptyCumulative);

  const isMaster = profile?.role === 'master';

  useEffect(() => {
    if (isMaster) {
      loadMasterData();
    } else if (activeOrg) {
      loadOrgData();
    } else {
      setLoading(false);
    }
  }, [isMaster, activeOrg]);

  async function loadMasterData() {
    const [{ count: orgs }, { count: users }, { count: active }, { data: recentOrgData }, { data: recentUserData }] =
      await Promise.all([
        supabase.from('organizations').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('organizations').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('organizations').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(5),
      ]);
    setOrgCount(orgs || 0);
    setUserCount(users || 0);
    setActiveOrgs(active || 0);
    setRecentOrgs(recentOrgData || []);
    setRecentUsers(recentUserData || []);
    setLoading(false);
  }

  async function loadOrgData() {
    if (!activeOrg) return;
    const orgId = activeOrg.id;
    const isCom = isCommercial(activeOrg.type);
    const isPropiedad = isPH(activeOrg.type);
    const { start, end } = monthRange();

    let month: PeriodStats = emptyPeriod;
    let cum: CumulativeStats = { ...emptyCumulative };

    if (isCom) {
      const [
        { count: monthInvCount },
        { data: monthInvData },
        { data: monthCashData },
        { count: allInvCount },
        { data: allInvData },
        { data: allCashData },
        { count: prodCount },
      ] = await Promise.all([
        supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pagada').gte('date', start).lte('date', end),
        supabase.from('invoices').select('total').eq('organization_id', orgId).eq('status', 'pagada').gte('date', start).lte('date', end),
        supabase.from('cash_entries').select('type, amount').eq('organization_id', orgId).gte('date', start).lte('date', end),
        supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pagada'),
        supabase.from('invoices').select('total').eq('organization_id', orgId).eq('status', 'pagada'),
        supabase.from('cash_entries').select('type, amount').eq('organization_id', orgId),
        supabase.from('products').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
      ]);

      const monthRevenue = (monthInvData || []).reduce((s, r) => s + r.total, 0);
      const monthCashEntries = (monthCashData || []) as { type: string; amount: number }[];
      const monthCashIn = monthCashEntries.filter(e => e.type === 'ingreso').reduce((s, e) => s + e.amount, 0);
      const monthCashOut = monthCashEntries.filter(e => e.type === 'egreso').reduce((s, e) => s + e.amount, 0);

      month = {
        invoices: monthInvCount || 0,
        revenue: monthRevenue,
        cashIn: monthCashIn,
        cashOut: monthCashOut,
        cashBalance: monthCashIn - monthCashOut,
      };

      const allRevenue = (allInvData || []).reduce((s, r) => s + r.total, 0);
      const allCashEntries = (allCashData || []) as { type: string; amount: number }[];
      const allCashIn = allCashEntries.filter(e => e.type === 'ingreso').reduce((s, e) => s + e.amount, 0);
      const allCashOut = allCashEntries.filter(e => e.type === 'egreso').reduce((s, e) => s + e.amount, 0);

      cum = {
        invoices: allInvCount || 0,
        revenue: allRevenue,
        cashIn: allCashIn,
        cashOut: allCashOut,
        cashBalance: allCashIn - allCashOut,
        products: prodCount || 0,
        pendingDues: 0,
        units: 0,
      };
    }

    if (isPropiedad) {
      const [{ data: duesData }, { count: unitsCount }] = await Promise.all([
        supabase.from('dues').select('balance').eq('organization_id', orgId).in('status', ['pendiente', 'parcial']),
        supabase.from('units').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
      ]);
      cum.pendingDues = (duesData || []).reduce((s, d) => s + d.balance, 0);
      cum.units = unitsCount || 0;
    }

    setMonthStats(month);
    setCumulative(cum);
    setLoading(false);
  }

  if (isMaster) {
    const stats = [
      { label: 'Organizaciones Totales', value: orgCount, icon: Building2, color: 'blue' },
      { label: 'Organizaciones Activas', value: activeOrgs, icon: TrendingUp, color: 'green' },
      { label: 'Usuarios del Sistema', value: userCount, icon: Users, color: 'purple' },
    ];
    const colorMap: Record<string, string> = {
      blue: 'from-blue-500 to-blue-600', green: 'from-green-500 to-green-600', purple: 'from-purple-500 to-purple-600',
    };

    return (
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Panel de Plataforma</h1>
          <p className="text-gray-500 mt-1">Gestión global de organizaciones y usuarios del sistema</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" /></div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <Card key={stat.label}><CardBody className="flex items-center gap-4">
                    <div className={`flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br ${colorMap[stat.color]} shadow-md`}>
                      <Icon className="w-7 h-7 text-white" />
                    </div>
                    <div><p className="text-sm text-gray-500">{stat.label}</p><p className="text-2xl font-bold text-gray-900 mt-0.5">{stat.value}</p></div>
                  </CardBody></Card>
                );
              })}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle>Organizaciones Recientes</CardTitle></CardHeader>
                <CardBody className="p-0">
                  {recentOrgs.length === 0 ? <p className="text-sm text-gray-400 px-6 py-8 text-center">No hay organizaciones registradas</p> : (
                    <div className="divide-y divide-gray-100">
                      {recentOrgs.map((org) => (
                        <div key={org.id} className="flex items-center gap-3 px-6 py-3">
                          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100">
                            {org.type === 'residencial' ? <Home className="w-5 h-5 text-gray-600" /> : <Store className="w-5 h-5 text-gray-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{org.name}</p>
                            <p className="text-xs text-gray-500">{organizationTypes[org.type]} · NIT: {org.nit || 'N/A'}</p>
                          </div>
                          <Badge variant={org.is_active ? 'green' : 'gray'}>{org.is_active ? 'Activa' : 'Inactiva'}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader><CardTitle>Usuarios Recientes</CardTitle></CardHeader>
                <CardBody className="p-0">
                  {recentUsers.length === 0 ? <p className="text-sm text-gray-400 px-6 py-8 text-center">No hay usuarios registrados</p> : (
                    <div className="divide-y divide-gray-100">
                      {recentUsers.map((user) => (
                        <div key={user.id} className="flex items-center gap-3 px-6 py-3">
                          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white text-sm font-semibold">
                            {user.full_name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{user.full_name || user.email}</p>
                            <p className="text-xs text-gray-500">{formatDateTime(user.created_at)}</p>
                          </div>
                          <Badge variant={user.role === 'master' ? 'purple' : user.role === 'admin' ? 'blue' : 'gray'}>{roleLabels[user.role]}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
          </>
        )}
      </div>
    );
  }

  // Non-master: org dashboard
  if (!activeOrg) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Bienvenido a Rela ERP</h1>
          <p className="text-gray-500 mt-1">Hola, {profile?.full_name || profile?.email}</p>
        </div>
        <Card>
          <CardBody className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-50 mb-4">
              <Building2 className="w-8 h-8 text-blue-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Sin Organización Asignada</h2>
            <p className="text-gray-500 max-w-md mx-auto">
              No tiene una organización asignada. Contacte al administrador del sistema para obtener acceso.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const com = isCommercial(activeOrg.type);
  const ph = isPH(activeOrg.type);

  const monthName = new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{activeOrg.name}</h1>
        <p className="text-gray-500 mt-1">{organizationTypes[activeOrg.type]} · {isOrgAdmin ? 'Administrador' : 'Colaborador'}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" /></div>
      ) : (
        <>
          {/* Month Summary */}
          {com && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900 capitalize">Mes Actual — {monthName}</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <Card><CardBody className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-100"><ShoppingCart className="w-6 h-6 text-blue-600" /></div>
                  <div><p className="text-sm text-gray-500">Facturas del Mes</p><p className="text-xl font-bold text-gray-900">{monthStats.invoices}</p></div>
                </CardBody></Card>
                <Card><CardBody className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-green-100"><TrendingUp className="w-6 h-6 text-green-600" /></div>
                  <div><p className="text-sm text-gray-500">Ingresos del Mes</p><p className="text-xl font-bold text-gray-900">{formatCOP(monthStats.revenue)}</p></div>
                </CardBody></Card>
                <Card><CardBody className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-green-100"><Wallet className="w-6 h-6 text-green-600" /></div>
                  <div><p className="text-sm text-gray-500">Entradas de Caja</p><p className="text-xl font-bold text-green-600">{formatCOP(monthStats.cashIn)}</p></div>
                </CardBody></Card>
                <Card><CardBody className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-red-100"><Wallet className="w-6 h-6 text-red-600" /></div>
                  <div><p className="text-sm text-gray-500">Salidas de Caja</p><p className="text-xl font-bold text-red-600">{formatCOP(monthStats.cashOut)}</p></div>
                </CardBody></Card>
              </div>
            </div>
          )}

          {/* Cumulative Summary */}
          {com && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Database className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-semibold text-gray-900">Acumulado Histórico</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <Card><CardBody className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-100"><ShoppingCart className="w-6 h-6 text-blue-600" /></div>
                  <div><p className="text-sm text-gray-500">Total Facturas</p><p className="text-xl font-bold text-gray-900">{cumulative.invoices}</p></div>
                </CardBody></Card>
                <Card><CardBody className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-green-100"><TrendingUp className="w-6 h-6 text-green-600" /></div>
                  <div><p className="text-sm text-gray-500">Ingresos Históricos</p><p className="text-xl font-bold text-gray-900">{formatCOP(cumulative.revenue)}</p></div>
                </CardBody></Card>
                <Card><CardBody className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-yellow-100"><Store className="w-6 h-6 text-yellow-600" /></div>
                  <div><p className="text-sm text-gray-500">Productos</p><p className="text-xl font-bold text-gray-900">{cumulative.products}</p></div>
                </CardBody></Card>
                <Card><CardBody className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-purple-100"><Wallet className="w-6 h-6 text-purple-600" /></div>
                  <div><p className="text-sm text-gray-500">Saldo Caja Histórico</p><p className={`text-xl font-bold ${cumulative.cashBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCOP(cumulative.cashBalance)}</p></div>
                </CardBody></Card>
              </div>
            </div>
          )}

          {/* PH Summary */}
          {ph && (
            <>
              <div className="mb-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  <Card><CardBody className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-100"><Home className="w-6 h-6 text-blue-600" /></div>
                    <div><p className="text-sm text-gray-500">Unidades</p><p className="text-xl font-bold text-gray-900">{cumulative.units}</p></div>
                  </CardBody></Card>
                  <Card><CardBody className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-red-100"><FileText className="w-6 h-6 text-red-600" /></div>
                    <div><p className="text-sm text-gray-500">Cartera Pendiente</p><p className="text-xl font-bold text-red-600">{formatCOP(cumulative.pendingDues)}</p></div>
                  </CardBody></Card>
                  <Card><CardBody className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-green-100"><Landmark className="w-6 h-6 text-green-600" /></div>
                    <div><p className="text-sm text-gray-500">Recaudos</p><p className="text-xl font-bold text-gray-900">--</p></div>
                  </CardBody></Card>
                </div>
              </div>

              {/* PH Module Quick Access */}
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <Layers className="w-5 h-5 text-blue-600" />
                  <h2 className="text-lg font-semibold text-gray-900">Módulos de Propiedad Horizontal</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                  {[
                    { to: '/inmuebles', label: 'Inmuebles y Copropietarios', desc: 'Gestión de unidades y propietarios', icon: Home, color: 'blue' },
                    { to: '/calendario', label: 'Calendario de Recaudo y Periodos', desc: 'Configuración de periodos y fechas', icon: Calendar, color: 'green' },
                    { to: '/conceptos', label: 'Conceptos de Cobro y Cuentas PUC', desc: 'Conceptos y mapeo contable NIIF', icon: Layers, color: 'yellow' },
                    { to: '/descuentos', label: 'Descuentos por Pronto Pago', desc: 'Descuentos escalonados y pre-facturación', icon: Percent, color: 'purple' },
                  ].map((mod) => {
                    const Icon = mod.icon;
                    const colorMap: Record<string, string> = {
                      blue: 'bg-blue-100 text-blue-600',
                      green: 'bg-green-100 text-green-600',
                      yellow: 'bg-yellow-100 text-yellow-600',
                      purple: 'bg-purple-100 text-purple-600',
                    };
                    return (
                      <Link key={mod.to} to={mod.to} className="group">
                        <Card className="h-full transition-all duration-200 hover:shadow-lg hover:border-blue-300">
                          <CardBody className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${colorMap[mod.color]}`}>
                                <Icon className="w-6 h-6" />
                              </div>
                              <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{mod.label}</p>
                              <p className="text-xs text-gray-500 mt-1">{mod.desc}</p>
                            </div>
                          </CardBody>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {!isOrgAdmin && (
            <Card>
              <CardBody className="text-center py-8">
                <p className="text-sm text-gray-500">Tiene acceso a los módulos operativos de esta organización. Los módulos contables y financieros están reservados para administradores.</p>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
