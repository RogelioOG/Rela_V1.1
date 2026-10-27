import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type UserRole = 'master' | 'admin' | 'user';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  type: 'tienda' | 'supermercado' | 'residencial' | 'otro';
  nit: string | null;
  address: string;
  phone: string;
  email: string;
  city: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserOrganization {
  id: string;
  user_id: string;
  organization_id: string;
  role: 'admin' | 'user';
  created_at: string;
  profiles?: Profile;
  organizations?: Organization;
}

export interface ThirdParty {
  id: string;
  organization_id: string;
  type: 'cliente' | 'proveedor';
  name: string;
  document_type: 'nit' | 'cedula';
  document_number: string;
  address: string;
  phone: string;
  email: string;
  city: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  organization_id: string;
  sku: string;
  name: string;
  category: string;
  stock: number;
  min_stock: number;
  cost_price: number;
  sale_price: number;
  is_active: boolean;
  tax_enabled: boolean;
  tax_rate: number;
  tax_name: string;
  discount_enabled: boolean;
  discount_type: 'porcentaje' | 'monto';
  discount_value: number;
  discount_start_date: string | null;
  discount_end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  organization_id: string;
  number: string;
  third_party_id: string | null;
  date: string;
  subtotal: number;
  tax: number;
  total: number;
  payment_method: 'efectivo' | 'transferencia' | 'credito';
  status: 'pagada' | 'credito' | 'anulada';
  notes: string;
  credit_term_days: number | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  cancelled_by: string | null;
  created_at: string;
  third_parties?: ThirdParty;
  invoice_items?: InvoiceItem[];
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  tax_rate: number;
  tax_amount: number;
  discount_amount: number;
}

export interface CashEntry {
  id: string;
  organization_id: string;
  type: 'ingreso' | 'egreso';
  date: string;
  concept: string;
  amount: number;
  payment_method: 'efectivo' | 'transferencia';
  reference: string;
  document_type: string | null;
  document_number: number | null;
  third_party_id: string | null;
  created_at: string;
}

export interface Unit {
  id: string;
  organization_id: string;
  tower: string;
  unit_label: string;
  type: 'apartamento' | 'casa' | 'local' | 'oficina' | 'parqueadero';
  coefficient: number;
  owner_name: string;
  owner_document: string;
  owner_phone: string;
  payment_reference: string | null;
  built_area: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  unit_owners?: UnitOwner[];
}

export interface UnitOwner {
  id: string;
  organization_id: string;
  unit_id: string;
  position: 1 | 2;
  document_type: 'CC' | 'NIT' | 'CE' | 'Pasaporte';
  document_number: string;
  first_name: string;
  last_name: string;
  business_name: string;
  email: string;
  phone: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface RevenuePeriod {
  id: string;
  organization_id: string;
  name: string;
  frequency: 'mensual' | 'bimestral' | 'trimestral' | 'anual';
  start_date: string;
  end_date: string;
  billing_day: number;
  due_day: number;
  grace_days: number;
  offset_days: number;
  interest_start_date: string | null;
  late_interest_rate: number;
  discount_threshold_days: number;
  discount_rate: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DiscountTier {
  id: string;
  organization_id: string;
  revenue_period_id: string;
  tier_order: number;
  name: string;
  discount_type: 'porcentaje' | 'monto';
  discount_value: number;
  valid_until_day: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BillingConcept {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  description: string;
  category: 'administracion' | 'extraordinaria' | 'penalizacion' | 'reserva' | 'fondo' | 'servicio' | 'otro';
  account_class: 'real' | 'orden';
  income_account_id: string | null;
  counterpart_account_id: string | null;
  parent_concept_id: string | null;
  is_late_interest: boolean;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  income_account?: Account;
  counterpart_account?: Account;
  parent_concept?: BillingConcept;
}

export interface Due {
  id: string;
  organization_id: string;
  unit_id: string;
  type: 'ordinaria' | 'extraordinaria';
  period: string;
  due_date: string;
  amount: number;
  interest_rate: number;
  balance: number;
  status: 'pendiente' | 'pagada' | 'parcial' | 'anulada';
  created_at: string;
  units?: Unit;
}

export interface Payment {
  id: string;
  organization_id: string;
  due_id: string;
  unit_id: string | null;
  date: string;
  amount: number;
  method: 'efectivo' | 'transferencia' | 'cheque';
  reference: string;
  created_at: string;
}

export interface Account {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  type: 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'gasto' | 'costo' | 'costo_ventas' | 'orden_deudora' | 'orden_acreedora';
  parent_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  organization_id: string;
  date: string;
  description: string;
  reference_type: string;
  reference_id: string | null;
  document_type: string | null;
  document_number: number | null;
  is_manual: boolean;
  created_at: string;
  journal_lines?: JournalLine[];
}

export interface AccountingDocument {
  id: string;
  organization_id: string;
  prefix: string;
  label: string;
  next_consecutive: number;
  created_at: string;
  updated_at: string;
}

export interface AccountingPeriod {
  id: string;
  organization_id: string;
  month: number;
  year: number;
  label: string;
  status: 'open' | 'closed';
  start_date: string;
  end_date: string;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface JournalLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  third_party_id: string | null;
  accounts?: Account;
}

export interface AccountMapping {
  id: string;
  organization_id: string;
  movement_type: string;
  account_id: string;
  debit_credit: 'debit' | 'credit';
  created_at: string;
  accounts?: Account;
}
