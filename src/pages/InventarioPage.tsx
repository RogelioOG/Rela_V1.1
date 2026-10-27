import { useEffect, useState } from 'react';
import { Store, Plus, Pencil, Trash2, Search, Loader2, AlertTriangle, Tag, Percent, ShieldAlert } from 'lucide-react';
import { supabase, Product } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrganizationContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { NoOrgSelected } from '@/components/shared';
import { formatCOP, formatNumber, formatShortDate } from '@/lib/format';

interface FormState {
  sku: string; name: string; category: string;
  stock: string; min_stock: string; cost_price: string; sale_price: string;
  is_active: boolean;
  tax_enabled: boolean;
  tax_rate: string;
  tax_name: string;
  discount_enabled: boolean;
  discount_type: 'porcentaje' | 'monto';
  discount_value: string;
  discount_start_date: string;
  discount_end_date: string;
  discount_indefinite: boolean;
}

const emptyForm: FormState = {
  sku: '', name: '', category: '', stock: '0', min_stock: '0',
  cost_price: '0', sale_price: '0', is_active: true,
  tax_enabled: false, tax_rate: '19', tax_name: 'IVA',
  discount_enabled: false, discount_type: 'porcentaje', discount_value: '0',
  discount_start_date: '', discount_end_date: '', discount_indefinite: true,
};

function isDiscountActive(p: Product): boolean {
  if (!p.discount_enabled) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (p.discount_start_date && today < p.discount_start_date) return false;
  if (p.discount_end_date && today > p.discount_end_date) return false;
  return true;
}

export default function InventarioPage() {
  const { activeOrg, isOrgAdmin } = useOrg();
  const { profile } = useAuth();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const canDelete = isOrgAdmin || profile?.role === 'master';

  useEffect(() => { if (activeOrg) loadItems(); }, [activeOrg]);

  async function loadItems() {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase.from('products').select('*').eq('organization_id', activeOrg.id).order('name', { ascending: true });
    setItems(data || []);
    setLoading(false);
  }

  const filtered = items.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.includes(search) || p.category.toLowerCase().includes(search.toLowerCase()));

  function openCreate() { setEditing(null); setForm(emptyForm); setError(''); setModalOpen(true); }
  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      sku: p.sku, name: p.name, category: p.category,
      stock: String(p.stock), min_stock: String(p.min_stock),
      cost_price: String(p.cost_price), sale_price: String(p.sale_price), is_active: p.is_active,
      tax_enabled: p.tax_enabled, tax_rate: String(p.tax_rate), tax_name: p.tax_name,
      discount_enabled: p.discount_enabled, discount_type: p.discount_type,
      discount_value: String(p.discount_value),
      discount_start_date: p.discount_start_date || '',
      discount_end_date: p.discount_end_date || '',
      discount_indefinite: !p.discount_start_date && !p.discount_end_date,
    });
    setError(''); setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    if (!activeOrg) return;

    if (form.tax_enabled && (parseFloat(form.tax_rate) < 0 || parseFloat(form.tax_rate) > 100)) {
      setError('La tasa de impuesto debe estar entre 0 y 100.');
      setSaving(false); return;
    }
    if (form.discount_enabled && parseFloat(form.discount_value) <= 0) {
      setError('El valor del descuento debe ser mayor que cero.');
      setSaving(false); return;
    }
    if (form.discount_enabled && !form.discount_indefinite) {
      if (!form.discount_start_date || !form.discount_end_date) {
        setError('Especifique fecha de inicio y fin del descuento, o marque "Tiempo indefinido".');
        setSaving(false); return;
      }
      if (form.discount_end_date < form.discount_start_date) {
        setError('La fecha de fin del descuento no puede ser anterior a la de inicio.');
        setSaving(false); return;
      }
    }

    const payload = {
      organization_id: activeOrg.id, sku: form.sku, name: form.name, category: form.category,
      stock: parseFloat(form.stock) || 0, min_stock: parseFloat(form.min_stock) || 0,
      cost_price: parseFloat(form.cost_price) || 0, sale_price: parseFloat(form.sale_price) || 0,
      is_active: form.is_active,
      tax_enabled: form.tax_enabled,
      tax_rate: parseFloat(form.tax_rate) || 0,
      tax_name: form.tax_name || 'IVA',
      discount_enabled: form.discount_enabled,
      discount_type: form.discount_type,
      discount_value: parseFloat(form.discount_value) || 0,
      discount_start_date: form.discount_enabled && !form.discount_indefinite ? form.discount_start_date : null,
      discount_end_date: form.discount_enabled && !form.discount_indefinite ? form.discount_end_date : null,
    };

    if (editing) {
      const { error: err } = await supabase.from('products').update(payload).eq('id', editing.id);
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      const { error: err } = await supabase.from('products').insert(payload);
      if (err) { setError(err.message); setSaving(false); return; }
    }
    setSaving(false); setModalOpen(false); await loadItems();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await supabase.from('products').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null); await loadItems();
  }

  if (!activeOrg) return <NoOrgSelected />;

  const lowStock = items.filter(p => p.stock <= p.min_stock).length;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventario</h1>
          <p className="text-gray-500 mt-1">Productos y existencias</p>
        </div>
        <div className="flex gap-3">
          {lowStock > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200">
              <AlertTriangle className="w-4 h-4 text-yellow-600" />
              <span className="text-sm text-yellow-700">{lowStock} producto(s) con stock bajo</span>
            </div>
          )}
          <Button onClick={openCreate}><Plus className="w-4 h-4" /> Nuevo Producto</Button>
        </div>
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" placeholder="Buscar por nombre, SKU o categoría..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4"><Store className="w-8 h-8 text-gray-400" /></div>
            <p className="text-gray-500">No se encontraron productos</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Producto</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Categoría</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Stock</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden lg:table-cell">Costo</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Venta</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Impuesto</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3 hidden md:table-cell">Descuento</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase px-6 py-3">Estado</th>
                  <th className="text-right text-xs font-semibold text-gray-600 uppercase px-6 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((p) => {
                  const discActive = isDiscountActive(p);
                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-500">SKU: {p.sku || 'N/A'}</p>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 hidden md:table-cell">{p.category || 'N/A'}</td>
                      <td className="px-6 py-4 text-right">
                        <span className={`text-sm font-medium ${p.stock <= p.min_stock ? 'text-red-600' : 'text-gray-900'}`}>{formatNumber(p.stock)}</span>
                        {p.stock <= p.min_stock && <p className="text-xs text-red-500">Stock mínimo</p>}
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-gray-700 hidden lg:table-cell">{formatCOP(p.cost_price)}</td>
                      <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">{formatCOP(p.sale_price)}</td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        {p.tax_enabled ? (
                          <Badge variant="blue">{p.tax_name} {p.tax_rate}%</Badge>
                        ) : (
                          <span className="text-xs text-gray-400">Exento</span>
                        )}
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        {p.discount_enabled ? (
                          <div className="flex flex-col gap-1">
                            <Badge variant={discActive ? 'green' : 'gray'}>
                              {p.discount_type === 'porcentaje' ? `${p.discount_value}%` : formatCOP(p.discount_value)}
                            </Badge>
                            {discActive ? (
                              <span className="text-xs text-green-600">Activo</span>
                            ) : p.discount_start_date || p.discount_end_date ? (
                              <span className="text-xs text-gray-400">
                                {p.discount_start_date ? formatShortDate(p.discount_start_date) : ''} - {p.discount_end_date ? formatShortDate(p.discount_end_date) : 'Indef.'}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">Indefinido</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">Sin descuento</span>
                        )}
                      </td>
                      <td className="px-6 py-4"><Badge variant={p.is_active ? 'green' : 'gray'}>{p.is_active ? 'Activo' : 'Inactivo'}</Badge></td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => openEdit(p)} className="p-2 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
                          {canDelete ? (
                            <button onClick={() => setDeleteTarget(p)} className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                          ) : (
                            <span className="p-2 rounded-lg text-gray-300 cursor-not-allowed" title="Solo los administradores pueden eliminar productos"><Trash2 className="w-4 h-4" /></span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Producto' : 'Nuevo Producto'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Basic info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Ej: PROD-001" />
            <Input label="Nombre *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input label="Categoría" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <Input label="Stock Actual" type="number" step="0.01" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
            <Input label="Stock Mínimo" type="number" step="0.01" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} />
            <Input label="Precio de Costo (COP)" type="number" step="0.01" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} />
            <Input label="Precio de Venta (COP)" type="number" step="0.01" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700">Producto activo</span>
          </label>

          {/* Tax section */}
          <div className="rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Percent className="w-4 h-4 text-gray-600" />
              <h4 className="text-sm font-semibold text-gray-700">Impuestos</h4>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.tax_enabled} onChange={(e) => setForm({ ...form, tax_enabled: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span className="text-sm text-gray-700">Aplicar impuesto a este producto</span>
            </label>
            {form.tax_enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-6">
                <Input label="Nombre del Impuesto" value={form.tax_name} onChange={(e) => setForm({ ...form, tax_name: e.target.value })} placeholder="IVA" />
                <Input label="Tasa (%)" type="number" step="0.01" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} placeholder="19" />
                <p className="col-span-full text-xs text-gray-500">Por defecto se usa IVA al 19%. Puede cambiar el nombre y la tasa si aplica un impuesto diferente (ej: INC, 8%, 0%).</p>
              </div>
            )}
          </div>

          {/* Discount section */}
          <div className="rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-gray-600" />
              <h4 className="text-sm font-semibold text-gray-700">Descuento</h4>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.discount_enabled} onChange={(e) => setForm({ ...form, discount_enabled: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span className="text-sm text-gray-700">Aplicar descuento</span>
            </label>
            {form.discount_enabled && (
              <div className="pl-6 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select label="Tipo de Descuento" value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value as 'porcentaje' | 'monto' })}>
                    <option value="porcentaje">Porcentaje (%)</option>
                    <option value="monto">Monto Fijo (COP)</option>
                  </Select>
                  <Input
                    label={form.discount_type === 'porcentaje' ? 'Porcentaje (%)' : 'Monto (COP)'}
                    type="number" step="0.01" value={form.discount_value}
                    onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input type="checkbox" checked={form.discount_indefinite} onChange={(e) => setForm({ ...form, discount_indefinite: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm text-gray-700">Tiempo indefinido (sin fecha de vencimiento)</span>
                  </label>
                  {!form.discount_indefinite && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Input label="Fecha de Inicio" type="date" value={form.discount_start_date} onChange={(e) => setForm({ ...form, discount_start_date: e.target.value })} />
                      <Input label="Fecha de Fin" type="date" value={form.discount_end_date} onChange={(e) => setForm({ ...form, discount_end_date: e.target.value })} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar Producto" size="sm">
        {canDelete ? (
          <>
            <p className="text-sm text-gray-600 mb-4">¿Eliminar <strong>{deleteTarget?.name}</strong>?</p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
              <Button variant="danger" onClick={handleDelete}>Sí, Eliminar</Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="w-5 h-5" />
              <p className="text-sm font-medium">Acción restringida</p>
            </div>
            <p className="text-sm text-gray-600">Solo los administradores pueden eliminar productos. Contacte a un administrador de la organización.</p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cerrar</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
