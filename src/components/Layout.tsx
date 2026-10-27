import { ReactNode, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Users,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Store,
  ClipboardList,
  ShoppingCart,
  Receipt,
  Wallet,
  Home,
  FileText,
  Landmark,
  BookOpen,
  BarChart3,
  ChevronRight,
  Calendar,
  Layers,
  Percent,
  Calculator,
  Bell,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrganizationContext';
import { roleLabels, organizationTypes, isCommercial, isPH } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';

interface NavSection {
  title: string;
  items: NavItem[];
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { activeOrg, orgs, setActiveOrg, isOrgAdmin, isOrgCollaborator } = useOrg();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);

  const isMaster = profile?.role === 'master';
  const orgType = activeOrg?.type || '';

  const sections: NavSection[] = [];

  // Master: ONLY platform management — no operational modules
  if (isMaster) {
    sections.push({
      title: 'Plataforma',
      items: [
        { to: '/', label: 'Panel Principal', icon: LayoutDashboard },
        { to: '/organizaciones', label: 'Organizaciones', icon: Building2 },
        { to: '/usuarios', label: 'Usuarios del Sistema', icon: Users },
      ],
    });
  } else if (activeOrg) {
    // Org users: dashboard + operational modules
    sections.push({
      title: 'General',
      items: [
        { to: '/', label: 'Panel Principal', icon: LayoutDashboard },
      ],
    });

    if (isCommercial(orgType)) {
      sections.push({
        title: 'Módulo Comercial',
        items: [
          { to: '/terceros', label: 'Terceros', icon: ClipboardList },
          { to: '/inventario', label: 'Inventario', icon: Store },
          { to: '/pos', label: 'Punto de Venta', icon: ShoppingCart },
          { to: '/ventas', label: 'Historial de Ventas', icon: Receipt },
          { to: '/caja', label: 'Caja y Egresos', icon: Wallet },
        ],
      });
    }

    if (isPH(orgType)) {
      sections.push({
        title: 'Propiedad Horizontal',
        items: [
          { to: '/inmuebles', label: 'Inmuebles', icon: Home },
          { to: '/conceptos', label: 'Conceptos de Cobro', icon: Layers },
          { to: '/calendario', label: 'Calendario de Recaudo', icon: Calendar },
          { to: '/cuotas', label: 'Cuotas de Administración', icon: Calculator },
          { to: '/novedades', label: 'Novedades del Periodo', icon: Bell },
          { to: '/descuentos', label: 'Descuentos por Pronto Pago', icon: Percent },
          { to: '/cartera', label: 'Cartera y Cuotas', icon: FileText },
          { to: '/recaudos', label: 'Recaudos', icon: Landmark },
        ],
      });
    }

    // Admins: full access including accounting and user management
    if (isOrgAdmin) {
      sections.push({
        title: 'Contabilidad',
        items: [
          { to: '/cuentas', label: 'Plan de Cuentas', icon: BookOpen },
          { to: '/asientos', label: 'Asientos Contables', icon: FileText },
          { to: '/reportes', label: 'Reportes', icon: BarChart3 },
        ],
      });
      sections.push({
        title: 'Administración',
        items: [
          { to: '/usuarios', label: 'Usuarios de la Organización', icon: Users },
        ],
      });
    }
    // Collaborators: no accounting, no user management — operational modules only
  }

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const currentPageLabel = (() => {
    for (const section of sections) {
      for (const item of section.items) {
        if (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)) {
          return item.label;
        }
      }
    }
    return 'Rela ERP';
  })();

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className={`fixed lg:sticky top-0 left-0 z-40 h-screen w-64 bg-gray-900 text-gray-300 flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="flex items-center gap-3 px-6 h-16 border-b border-gray-800">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold text-white tracking-tight">Rela ERP</span>
        </div>

        {activeOrg && (
          <div className="px-4 py-3 border-b border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Organización Activa</p>
            <p className="text-sm font-medium text-gray-200 truncate">{activeOrg.name}</p>
            <p className="text-xs text-gray-500">{organizationTypes[activeOrg.type]}</p>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="px-3 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">{section.title}</p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-400 hover:text-white hover:bg-gray-800'
                        }`
                      }
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-gray-800">
          <div className="px-3 py-2 text-xs text-gray-500">
            Rela ERP &copy; {new Date().getFullYear()}
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <h2 className="text-base font-semibold text-gray-800 hidden sm:block">{currentPageLabel}</h2>
          </div>

          <div className="flex items-center gap-3">
            {/* Org selector — only for non-master users with multiple orgs, or master with orgs */}
            {orgs.length > 0 && !isMaster && (
              <div className="relative">
                <button
                  onClick={() => setOrgMenuOpen(!orgMenuOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
                >
                  <Building2 className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-700 hidden sm:block max-w-[140px] truncate">
                    {activeOrg?.name || 'Seleccionar...'}
                  </span>
                  <ChevronDown className="w-3 h-3 text-gray-400" />
                </button>
                {orgMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setOrgMenuOpen(false)} />
                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-40 max-h-80 overflow-y-auto">
                      {orgs.map((org) => (
                        <button
                          key={org.id}
                          onClick={() => { setActiveOrg(org); setOrgMenuOpen(false); }}
                          className={`flex items-center justify-between w-full px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors ${
                            activeOrg?.id === org.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                          }`}
                        >
                          <span className="truncate">{org.name}</span>
                          {activeOrg?.id === org.id && <ChevronRight className="w-4 h-4" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white text-sm font-semibold">
                  {profile?.full_name?.charAt(0).toUpperCase() || profile?.email?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-sm font-medium text-gray-800 leading-tight">
                    {profile?.full_name || profile?.email}
                  </p>
                  <p className="text-xs text-gray-500 leading-tight">{roleLabels[profile?.role || 'user']}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-40">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-800">{profile?.email}</p>
                      <div className="mt-1">
                        <Badge variant={isMaster ? 'purple' : 'blue'}>
                          {roleLabels[profile?.role || 'user']}
                        </Badge>
                      </div>
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Cerrar Sesión
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
