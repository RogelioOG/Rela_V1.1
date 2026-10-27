import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { OrganizationProvider, useOrg } from '@/contexts/OrganizationContext';
import Layout from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import OrganizationsPage from '@/pages/OrganizationsPage';
import UsersPage from '@/pages/UsersPage';
import TercerosPage from '@/pages/TercerosPage';
import InventarioPage from '@/pages/InventarioPage';
import POSPage from '@/pages/POSPage';
import VentasPage from '@/pages/VentasPage';
import CajaPage from '@/pages/CajaPage';
import InmueblesPage from '@/pages/InmueblesPage';
import CarteraPage from '@/pages/CarteraPage';
import RecaudosPage from '@/pages/RecaudosPage';
import CalendarioPage from '@/pages/CalendarioPage';
import ConceptosPage from '@/pages/ConceptosPage';
import DescuentosPage from '@/pages/DescuentosPage';
import CuotasPage from '@/pages/CuotasPage';
import NovedadesPage from '@/pages/NovedadesPage';
import AcuerdosPagoPage from '@/pages/AcuerdosPagoPage';
import CuentasPage from '@/pages/CuentasPage';
import AsientosPage from '@/pages/AsientosPage';
import ReportesPage from '@/pages/ReportesPage';
import { Loader2 } from 'lucide-react';
import { NoOrgSelected } from '@/components/shared';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/login" replace />;
  }

  return (
    <OrganizationProvider>
      <Layout>{children}</Layout>
    </OrganizationProvider>
  );
}

function LoginRoute() {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (profile) {
    return <Navigate to="/" replace />;
  }

  return <LoginPage />;
}

/** Master-only routes: organizations, global users */
function MasterRoute({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  if (profile?.role !== 'master') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Org admin-only routes: accounting, reports, org user management */
function OrgAdminRoute({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const { isOrgAdmin, activeOrg } = useOrg();
  if (profile?.role === 'master') return <Navigate to="/" replace />;
  if (!activeOrg) return <NoOrgSelected />;
  if (!isOrgAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Org member routes: operational modules (admin + collaborator) */
function OrgMemberRoute({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const { activeOrg } = useOrg();
  if (profile?.role === 'master') return <Navigate to="/" replace />;
  if (!activeOrg) return <NoOrgSelected />;
  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />

          {/* All authenticated users see the dashboard */}
          <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />

          {/* Master-only: platform management */}
          <Route path="/organizaciones" element={<ProtectedRoute><MasterRoute><OrganizationsPage /></MasterRoute></ProtectedRoute>} />
          <Route path="/usuarios" element={<ProtectedRoute><UsersPage /></ProtectedRoute>} />

          {/* Org operational modules: admin + collaborator */}
          <Route path="/terceros" element={<ProtectedRoute><OrgMemberRoute><TercerosPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/inventario" element={<ProtectedRoute><OrgMemberRoute><InventarioPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/pos" element={<ProtectedRoute><OrgMemberRoute><POSPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/ventas" element={<ProtectedRoute><OrgMemberRoute><VentasPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/caja" element={<ProtectedRoute><OrgMemberRoute><CajaPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/inmuebles" element={<ProtectedRoute><OrgMemberRoute><InmueblesPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/cartera" element={<ProtectedRoute><OrgMemberRoute><CarteraPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/acuerdos-pago" element={<ProtectedRoute><OrgMemberRoute><AcuerdosPagoPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/recaudos" element={<ProtectedRoute><OrgMemberRoute><RecaudosPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/calendario" element={<ProtectedRoute><OrgMemberRoute><CalendarioPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/conceptos" element={<ProtectedRoute><OrgMemberRoute><ConceptosPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/descuentos" element={<ProtectedRoute><OrgMemberRoute><DescuentosPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/cuotas" element={<ProtectedRoute><OrgMemberRoute><CuotasPage /></OrgMemberRoute></ProtectedRoute>} />
          <Route path="/novedades" element={<ProtectedRoute><OrgMemberRoute><NovedadesPage /></OrgMemberRoute></ProtectedRoute>} />

          {/* Org admin-only: accounting and financial reports */}
          <Route path="/cuentas" element={<ProtectedRoute><OrgAdminRoute><CuentasPage /></OrgAdminRoute></ProtectedRoute>} />
          <Route path="/asientos" element={<ProtectedRoute><OrgAdminRoute><AsientosPage /></OrgAdminRoute></ProtectedRoute>} />
          <Route path="/reportes" element={<ProtectedRoute><OrgAdminRoute><ReportesPage /></OrgAdminRoute></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
