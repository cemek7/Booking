"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTenant } from '@/lib/supabase/tenant-context';
import { isGlobalAdmin, hasRole } from "@/lib/auth/auth-manager";

type Props = {
  allowedRoles?: string[]; // tenant roles (owner, staff, etc.)
  requireAdmin?: boolean; // require global admin flag
  children: React.ReactNode;
};

export default function RoleGuard({ allowedRoles, requireAdmin, children }: Props) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const { role } = useTenant();

  useEffect(() => {
    try {
      if (requireAdmin) {
        if (!isGlobalAdmin()) {
          router.replace('/');
          return;
        }
      }

      if (allowedRoles && allowedRoles.length > 0) {
        const current = (role || 'staff').toLowerCase();
        if (!allowedRoles.map(r => r.toLowerCase()).includes(current)) {
          router.replace('/');
          return;
        }
      }
    } catch {
      try { router.replace('/'); } catch {}
      return;
    } finally { 
      setReady(true); 
    }
  }, [allowedRoles, requireAdmin, router, role]);

  if (!ready) return null;
  return <>{children}</>;
}
