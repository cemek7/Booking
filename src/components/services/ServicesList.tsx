'use client';

import React, { memo, useCallback } from 'react';
import { useRouter } from "next/navigation";
import { Table, THead, TBody, TR, TH, TD } from "../ui/table";
import Button from "../ui/button";
import { Badge } from '../ui/badge';
import { toast } from '../ui/toast';
import { useTenant } from "@/lib/supabase/tenant-context";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch, authDelete } from "@/lib/auth/auth-api-client";

interface Service {
  id: number;
  name: string;
  description?: string;
  price?: number;
  duration?: number;
  category?: string;
  created_at?: string;
}

interface ServiceRowProps {
  service: Service;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
}

const ServiceRow = memo<ServiceRowProps>(function ServiceRow({ service, onEdit, onDelete }) {
  const handleEdit = useCallback(() => {
    onEdit(service.id);
  }, [onEdit, service.id]);

  const handleDelete = useCallback(() => {
    onDelete(service.id);
  }, [onDelete, service.id]);

  return (
    <TR>
      <TD className="font-medium text-slate-900">{service.id}</TD>
      <TD className="font-medium text-slate-900">{service.name}</TD>
      <TD className="max-w-[26rem] whitespace-normal text-slate-600">{service.description || '—'}</TD>
      <TD className="font-medium text-slate-900">{typeof service.price === 'number' ? service.price : '—'}</TD>
      <TD>{typeof service.duration === 'number' ? `${service.duration} min` : '—'}</TD>
      <TD>{service.category || '—'}</TD>
      <TD>{service.created_at ? new Date(service.created_at).toLocaleString() : '—'}</TD>
      <TD>
        <Button className="mr-2 px-2 py-1 text-xs" onClick={handleEdit}>Edit</Button>
        <Button className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600" onClick={handleDelete}>Delete</Button>
      </TD>
    </TR>
  );
});

export default function ServicesList() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const router = useRouter();
  const { data, error, isLoading } = useQuery({
    queryKey: ['services', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];
      const response = await authFetch('/api/services');
      if (response.error) throw new Error('Failed services fetch');
      const payload = response.data as unknown;
      if (Array.isArray(payload)) return payload;
      if (payload && typeof payload === 'object') {
        const nested = (payload as { data?: unknown }).data;
        if (Array.isArray(nested)) return nested;
      }
      return [];
    },
    enabled: !!tenant?.id
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await authDelete(`/api/services?id=eq.${id}`);
      if (response.error) throw new Error('Delete failed');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services', tenant?.id] })
  });

  const handleEdit = useCallback((id: number) => {
    router.push(`/dashboard/services/${id}`);
  }, [router]);

  const handleDelete = useCallback((id: number) => {
    if (!confirm('Are you sure you want to delete this service?')) return;
    deleteMutation.mutate(id, {
      onError: () => toast.error('Failed to delete service')
    });
  }, [deleteMutation]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-500 shadow-sm">
        Loading services...
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-sm text-red-700 shadow-sm">
        Error loading services.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Services</h2>
          <p className="text-sm text-slate-500">Manage services, pricing, duration, and categories.</p>
        </div>
        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
          {data?.length ?? 0} services
        </Badge>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[960px]">
          <THead>
            <TR>
              <TH className="w-16">ID</TH>
              <TH className="w-40">Name</TH>
              <TH className="min-w-[280px]">Description</TH>
              <TH className="w-24">Price</TH>
              <TH className="w-24">Duration</TH>
              <TH className="w-28">Category</TH>
              <TH className="w-36">Created At</TH>
              <TH className="w-28">&nbsp;</TH>
            </TR>
          </THead>
          <TBody>
            {data && data.length > 0 ? (
              data.map((service: Service) => (
                <ServiceRow
                  key={service.id}
                  service={service}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            ) : (
              <TR>
                <TD colSpan={8} className="text-center text-slate-500">No services found.</TD>
              </TR>
            )}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
