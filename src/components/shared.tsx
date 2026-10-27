import { useOrg } from '@/contexts/OrganizationContext';
import { Building2 } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';

export function NoOrgSelected() {
  return (
    <div className="max-w-4xl mx-auto">
      <Card>
        <CardBody className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4">
            <Building2 className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Sin Organización Activa</h2>
          <p className="text-gray-500 max-w-md mx-auto">
            Seleccione una organización en la barra superior para acceder a los módulos correspondientes.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

export function useActiveOrgId(): string | null {
  const { activeOrg } = useOrg();
  return activeOrg?.id ?? null;
}
