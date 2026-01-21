'use client';

import { useEffect, useState } from 'react';
import { publicBookingAPI } from '@/lib/publicBookingAPI';
import { useToast } from '@/hooks/useToast';
import LoadingSpinner from './LoadingSpinner';

interface TenantHeaderProps {
  slug: string;
}

interface TenantInfo {
  id: string;
  name: string;
  logo?: string;
  description?: string;
}

export default function TenantHeader({ slug }: TenantHeaderProps) {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const loadTenant = async () => {
      try {
        const data = await publicBookingAPI.getTenantPublicInfo(slug);
        setTenant(data);
      } catch (error) {
        toast({
          title: 'Error Loading Business Info',
          description: 'Failed to load business information',
          type: 'error',
        });
      } finally {
        setLoading(false);
      }
    };

    loadTenant();
  }, [slug, toast]);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!tenant) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg p-6 shadow-sm border border-slate-200">
      <div className="flex items-start gap-4">
        {tenant.logo && (
          <img
            src={tenant.logo}
            alt={tenant.name}
            className="w-16 h-16 rounded-lg object-cover"
          />
        )}
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-slate-900">{tenant.name}</h1>
          {tenant.description && (
            <p className="text-slate-600 mt-2">{tenant.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}
