export function formatCOP(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function toDateLocal(date: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(date);
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(toDateLocal(date));
}

export function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(toDateLocal(date));
}

export function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

export const organizationTypes: Record<string, string> = {
  tienda: 'Tienda',
  supermercado: 'Supermercado',
  residencial: 'Propiedad Horizontal',
  otro: 'Otro',
};

export const roleLabels: Record<string, string> = {
  master: 'Super Administrador',
  admin: 'Administrador',
  user: 'Colaborador',
};

export const orgRoleLabels: Record<string, string> = {
  admin: 'Administrador',
  user: 'Colaborador',
};

export const thirdPartyTypeLabels: Record<string, string> = {
  cliente: 'Cliente',
  proveedor: 'Proveedor',
};

export const documentTypeLabels: Record<string, string> = {
  nit: 'NIT',
  cedula: 'Cédula',
};

export const paymentMethodLabels: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  credito: 'Crédito / Fiado',
  cheque: 'Cheque',
};

export const invoiceStatusLabels: Record<string, string> = {
  pagada: 'Pagada',
  credito: 'Crédito',
  anulada: 'Anulada',
};

export const dueTypeLabels: Record<string, string> = {
  ordinaria: 'Ordinaria',
  extraordinaria: 'Extraordinaria',
};

export const dueStatusLabels: Record<string, string> = {
  pendiente: 'Pendiente',
  pagada: 'Pagada',
  parcial: 'Parcial',
  anulada: 'Anulada',
};

export const unitTypeLabels: Record<string, string> = {
  apartamento: 'Apartamento',
  casa: 'Casa',
  local: 'Local',
  oficina: 'Oficina',
  parqueadero: 'Parqueadero',
};

export const accountTypeLabels: Record<string, string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  patrimonio: 'Patrimonio',
  ingreso: 'Ingreso',
  gasto: 'Gasto',
  costo: 'Costo (Clase 7 — Costos de Producción)',
  costo_ventas: 'Costo de Ventas (Clase 6 — Costos)',
  orden_deudora: 'Cuentas de Orden Deudoras (Clase 8)',
  orden_acreedora: 'Cuentas de Orden Acreedoras (Clase 9)',
};

export const cashTypeLabels: Record<string, string> = {
  ingreso: 'Ingreso',
  egreso: 'Egreso',
};

export const movementTypeLabels: Record<string, string> = {
  venta_efectivo_caja: 'Ventas en Efectivo (Caja)',
  venta_efectivo_ingreso: 'Ventas en Efectivo (Ingreso)',
  venta_credito_cartera: 'Ventas a Crédito (Cartera)',
  venta_credito_ingreso: 'Ventas a Crédito (Ingreso)',
  iva_recaudado: 'IVA Recaudado',
  cogs_costo: 'Costo de Mercancías Vendidas',
  cogs_inventario: 'Inventario para COGS',
  compra_inventario: 'Compra de Inventario (Activo)',
  compra_caja: 'Compra de Inventario (Caja)',
  recaudo_caja: 'Recaudo de Cuotas (Caja)',
  recaudo_ingreso: 'Recaudo de Cuotas (Ingreso)',
  caja_ingreso: 'Ingreso de Caja',
  caja_ingreso_contrapartida: 'Ingreso de Caja (Contrapartida)',
  caja_egreso: 'Egreso de Caja',
  caja_egreso_contrapartida: 'Egreso de Caja (Contrapartida)',
  inventario_activo: 'Inventario (Activo)',
  salida_inventario_caja: 'Salida de Inventario (Caja)',
  venta_descuento: 'Descuentos en Ventas (Contra-Ingreso)',
};

export const movementTypeDescriptions: Record<string, string> = {
  venta_efectivo_caja: 'Cuenta de caja/bancos que se debita al registrar una venta en efectivo',
  venta_efectivo_ingreso: 'Cuenta de ingresos que se acredita al registrar una venta en efectivo',
  venta_credito_cartera: 'Cuenta de cuentas por cobrar que se debita al vender a crédito',
  venta_credito_ingreso: 'Cuenta de ingresos que se acredita al vender a crédito',
  iva_recaudado: 'Cuenta de IVA por pagar que se acredita al registrar ventas con IVA',
  cogs_costo: 'Cuenta de costo de ventas que se debita al facturar',
  cogs_inventario: 'Cuenta de inventario que se acredita al facturar (COGS)',
  compra_inventario: 'Cuenta de inventario que se debita al registrar productos',
  compra_caja: 'Cuenta de caja que se acredita al registrar productos',
  recaudo_caja: 'Cuenta de caja que se debita al recibir un pago de cuota',
  recaudo_ingreso: 'Cuenta de ingresos por cuotas que se acredita al recibir un pago',
  caja_ingreso: 'Cuenta de caja que se debita al registrar un ingreso de caja',
  caja_ingreso_contrapartida: 'Cuenta de ingreso que se acredita al registrar un ingreso de caja',
  caja_egreso: 'Cuenta de caja que se acredita al registrar un egreso de caja',
  caja_egreso_contrapartida: 'Cuenta de gasto que se debita al registrar un egreso de caja',
  inventario_activo: 'Cuenta de inventario (activo) para valorización de existencias',
  salida_inventario_caja: 'Cuenta de caja para salidas de inventario',
  venta_descuento: 'Cuenta de descuentos en ventas (contra-ingreso) que se debita al aplicar descuentos en facturas',
};

export const documentTypeLabelsPH: Record<string, string> = {
  CC: 'Cédula de Ciudadanía',
  NIT: 'NIT',
  CE: 'Cédula de Extranjería',
  Pasaporte: 'Pasaporte',
};

export const revenueFrequencyLabels: Record<string, string> = {
  mensual: 'Mensual',
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  anual: 'Anual',
};

export const billingCategoryLabels: Record<string, string> = {
  administracion: 'Administración',
  extraordinaria: 'Extraordinaria',
  penalizacion: 'Penalización',
  reserva: 'Reserva',
  fondo: 'Fondo',
  servicio: 'Servicio',
  otro: 'Otro',
};

export const accountClassLabels: Record<string, string> = {
  real: 'Cuentas Reales (Clases 1-6)',
  orden: 'Cuentas de Orden (Clases 8-9)',
};

export function isCommercial(type: string): boolean {
  return type === 'tienda' || type === 'supermercado';
}

export function isPH(type: string): boolean {
  return type === 'residencial';
}

export const accountingDocLabels: Record<string, string> = {
  CE: 'Comprobante de Egreso',
  RC: 'Recibo de Caja',
  FV: 'Factura de Venta',
  FC: 'Factura de Compra',
  NC: 'Nota Crédito',
  ND: 'Nota Débito',
  NT: 'Comprobante Contable / Nota de Contabilidad',
  CC: 'Cuenta de Cobro',
};

export const defaultAccountingDocs: { prefix: string; label: string }[] = [
  { prefix: 'CE', label: 'Comprobante de Egreso' },
  { prefix: 'RC', label: 'Recibo de Caja' },
  { prefix: 'FV', label: 'Factura de Venta' },
  { prefix: 'FC', label: 'Factura de Compra' },
  { prefix: 'NC', label: 'Nota Crédito' },
  { prefix: 'ND', label: 'Nota Débito' },
  { prefix: 'NT', label: 'Comprobante Contable / Nota de Contabilidad' },
  { prefix: 'CC', label: 'Cuenta de Cobro' },
];
