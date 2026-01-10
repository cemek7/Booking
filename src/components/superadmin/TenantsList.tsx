import React from "react";

type Tenant = {
  id: string | number;
  name: string;
  status: string;
  users?: number;
  [key: string]: any;
};

export default function TenantsList({ tenants = [] }: { tenants: Tenant[] }) {
  return (
    <div className="bg-white rounded-xl shadow p-6 border border-gray-100">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="py-2">Tenant</th>
            <th className="py-2">Status</th>
            <th className="py-2">Users</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tenants.length > 0 ? tenants.map((t) => (
            <tr key={t.id} className="border-b last:border-0">
              <td className="py-2 font-medium text-gray-900">{t.name}</td>
              <td className="py-2">
                <span className={`px-2 py-1 rounded text-xs font-semibold ${
                  t.status === "Active"
                    ? "bg-green-100 text-green-700"
                    : t.status === "Trial"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-red-100 text-red-700"
                }`}>
                  {t.status}
                </span>
              </td>
              <td className="py-2">{t.users ?? "-"}</td>
              <td className="py-2">
                <button className="text-primary hover:underline text-xs">View</button>
                <button className="ml-2 text-gray-500 hover:text-red-600 text-xs">Suspend</button>
              </td>
            </tr>
          )) : (
            <tr><td colSpan={4} className="text-center p-4">No tenants found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
