import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase, Organization, UserOrganization } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface OrgContextType {
  activeOrg: Organization | null;
  orgs: Organization[];
  loading: boolean;
  setActiveOrg: (org: Organization | null) => void;
  refreshOrgs: () => Promise<void>;
  orgRole: 'admin' | 'user' | null;
  isOrgAdmin: boolean;
  isOrgCollaborator: boolean;
}

const OrgContext = createContext<OrgContextType | undefined>(undefined);

const STORAGE_KEY = 'rela_erp_active_org_id';

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrg, setActiveOrgState] = useState<Organization | null>(null);
  const [orgRole, setOrgRole] = useState<'admin' | 'user' | null>(null);
  const [loading, setLoading] = useState(true);

  const isMaster = profile?.role === 'master';

  const refreshOrgs = async () => {
    if (!profile) {
      setOrgs([]);
      setActiveOrgState(null);
      setOrgRole(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    if (isMaster) {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) {
        console.error('Error loading organizations:', error);
      } else {
        const list = data as Organization[];
        setOrgs(list);
        setOrgRole('admin');
        const savedId = localStorage.getItem(STORAGE_KEY);
        const saved = savedId ? list.find(o => o.id === savedId) : null;
        if (saved) setActiveOrgState(saved);
        else if (list.length > 0) setActiveOrgState(list[0]);
        else setActiveOrgState(null);
      }
      setLoading(false);
      return;
    }

    // Non-master: load only assigned organizations
    const { data: uoData, error: uoError } = await supabase
      .from('user_organizations')
      .select('*, organizations(*)')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: true });

    if (uoError) {
      console.error('Error loading user organizations:', uoError);
      setOrgs([]);
      setActiveOrgState(null);
      setOrgRole(null);
      setLoading(false);
      return;
    }

    const userOrgs = (uoData || []) as unknown as (UserOrganization & { organizations: Organization })[];
    const orgList = userOrgs.map(uo => uo.organizations).filter((o): o is Organization => !!o && o.is_active);
    setOrgs(orgList);

    const savedId = localStorage.getItem(STORAGE_KEY);
    const savedUo = savedId ? userOrgs.find(uo => uo.organization_id === savedId) : null;

    if (savedUo && savedUo.organizations?.is_active) {
      setActiveOrgState(savedUo.organizations);
      setOrgRole(savedUo.role);
    } else if (userOrgs.length > 0 && userOrgs[0].organizations?.is_active) {
      setActiveOrgState(userOrgs[0].organizations);
      setOrgRole(userOrgs[0].role);
    } else {
      setActiveOrgState(null);
      setOrgRole(null);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (profile) {
      refreshOrgs();
    } else {
      setOrgs([]);
      setActiveOrgState(null);
      setOrgRole(null);
      setLoading(false);
    }
  }, [profile]);

  const setActiveOrg = (org: Organization | null) => {
    if (org) {
      localStorage.setItem(STORAGE_KEY, org.id);
      // Find the role for this org
      if (isMaster) {
        setOrgRole('admin');
      } else {
        refreshOrgs().then(() => {
          // refreshOrgs will set the correct orgRole based on the saved org
        });
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    setActiveOrgState(org);
  };

  return (
    <OrgContext.Provider value={{
      activeOrg, orgs, loading, setActiveOrg, refreshOrgs,
      orgRole,
      isOrgAdmin: orgRole === 'admin',
      isOrgCollaborator: orgRole === 'user',
    }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrganizationProvider');
  return ctx;
}
