"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { storeSignInData, getRedirectUrl, determineUserType } from '@/lib/auth/auth-manager';

interface TenantOption {
  tenant_id: string;
  role: string;
  name: string | null;
  slug: string | null;
}

interface PickerState {
  accessToken: string;
  userId: string;
  email: string;
  tenants: TenantOption[];
}

export default function SelectTenantPage() {
  const router = useRouter();
  const [state] = useState<PickerState | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = sessionStorage.getItem('tenant_picker');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PickerState;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!state) {
      router.replace('/booka/auth/signin');
    }
  }, [router, state]);

  function select(tenant: TenantOption) {
    if (!state) return;
    sessionStorage.removeItem('tenant_picker');
    const normalizedRole = tenant.role as 'owner' | 'manager' | 'staff';
    storeSignInData({
      accessToken: state.accessToken,
      admin: false,
      tenant_id: tenant.tenant_id,
      role: normalizedRole,
      email: state.email,
      user_id: state.userId,
    });
    router.push(getRedirectUrl(determineUserType(false, normalizedRole), normalizedRole));
  }

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-lg p-6 space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Choose a workspace</h1>
          <p className="text-sm text-gray-500 mt-1">
            Signed in as <span className="font-medium text-gray-700">{state.email}</span>
          </p>
        </div>

        <div className="space-y-2">
          {state.tenants.map((t) => (
            <button
              key={t.tenant_id}
              onClick={() => select(t)}
              className="w-full flex items-center justify-between px-4 py-3 border border-gray-200 rounded-xl hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-left group"
            >
              <div>
                <p className="font-medium text-gray-900 group-hover:text-indigo-700">
                  {t.name ?? t.slug ?? t.tenant_id.slice(0, 8)}
                </p>
                <p className="text-xs text-gray-400 capitalize">{t.role}</p>
              </div>
              <svg className="w-4 h-4 text-gray-300 group-hover:text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>

        <button
          onClick={() => { sessionStorage.removeItem('tenant_picker'); router.push('/booka/auth/onboarding'); }}
          className="w-full text-sm text-indigo-600 hover:text-indigo-700 font-medium py-2 transition-colors"
        >
          + Create a new workspace
        </button>
      </div>
    </div>
  );
}
