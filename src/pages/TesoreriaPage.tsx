import { useState } from 'react';
import { PaymentMethodsConfig } from '@/components/treasury/PaymentMethodsConfig';
import { PaymentHierarchyConfig } from '@/components/treasury/PaymentHierarchyConfig';

type TreasuryTab = 'metodos' | 'prelacion';

const tabs: { id: TreasuryTab; label: string }[] = [
  { id: 'metodos', label: 'Métodos de Pago' },
  { id: 'prelacion', label: 'Prelación de Pagos' },
];

export default function TesoreriaPage() {
  const [activeTab, setActiveTab] = useState<TreasuryTab>('metodos');

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tesorería</h1>
        <p className="text-gray-500 mt-1">Configure los métodos de pago y el orden en que se aplican los recaudos</p>
      </div>

      <div className="mb-6 inline-flex rounded-lg bg-gray-100 p-1" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'metodos' ? <PaymentMethodsConfig /> : <PaymentHierarchyConfig />}
    </div>
  );
}
