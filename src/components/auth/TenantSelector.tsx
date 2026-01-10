"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/button";

export default function TenantSelector({ userTenants }: { userTenants: any[] }) {
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const router = useRouter();

  useEffect(() => {
    if (userTenants.length === 1) {
      // Only one tenant, auto-select and redirect
      router.push(`/dashboard?tenantId=${userTenants[0].tenant_id}`);
    }
  }, [userTenants, router]);

  const handleSelect = () => {
    if (selectedTenant) {
      try {
        // Persist selection for subsequent sessions
        localStorage.setItem('current_tenant', JSON.stringify({ id: selectedTenant }));
        // default role to owner for the selector flow; real role will be validated on signin
        localStorage.setItem('current_tenant_role', 'owner');
      } catch (e) {
        // ignore
      }
      router.push(`/dashboard?tenantId=${selectedTenant}`);
    }
  };

  if (userTenants.length <= 1) return null;

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded shadow">
      <h2 className="text-xl font-bold mb-4">Select Your Tenant</h2>
      <select
        className="w-full border rounded px-3 py-2 mb-4"
        value={selectedTenant}
        onChange={e => setSelectedTenant(e.target.value)}
      >
        <option value="" disabled>Select a tenant</option>
        {userTenants.map(tu => (
          <option key={tu.tenant_id} value={tu.tenant_id}>
            {tu.tenants?.name || tu.tenant_id}
          </option>
        ))}
      </select>
      <Button onClick={handleSelect} disabled={!selectedTenant}>
        Continue
      </Button>
    </div>
  );
}
