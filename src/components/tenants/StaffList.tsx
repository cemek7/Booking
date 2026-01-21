"use client";
import React, { memo, useCallback } from 'react';
import Button from '../ui/button';
import { useAuth } from "@/lib/supabase/auth-context";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface StaffMember {
  user_id: string;
  email: string;
  role: string;
}

interface StaffListItemProps {
  staff: StaffMember;
  currentUserId?: string;
  onRemove: (userId: string) => void;
  onRoleChange: (userId: string, newRole: string) => void;
}

const StaffListItem = memo<StaffListItemProps>(function StaffListItem({
  staff,
  currentUserId,
  onRemove,
  onRoleChange,
}) {
  const handleRemove = useCallback(() => {
    onRemove(staff.user_id);
  }, [onRemove, staff.user_id]);

  const handlePromote = useCallback(() => {
    onRoleChange(staff.user_id, "owner");
  }, [onRoleChange, staff.user_id]);

  const handleDemote = useCallback(() => {
    onRoleChange(staff.user_id, "staff");
  }, [onRoleChange, staff.user_id]);

  return (
    <li className="flex items-center justify-between border-b py-2">
      <span>
        {staff.email}
        <span className="ml-2 px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
          {staff.role.charAt(0).toUpperCase() + staff.role.slice(1)}
        </span>
      </span>
      <div className="flex gap-2">
        {staff.role === "staff" && (
          <Button
            type="button"
            className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 text-xs"
            onClick={handlePromote}
          >
            Promote to Owner
          </Button>
        )}
        {staff.role === "owner" && currentUserId !== staff.user_id && (
          <Button
            type="button"
            className="bg-yellow-500 hover:bg-yellow-600 text-white px-2 py-1 text-xs"
            onClick={handleDemote}
          >
            Demote to Staff
          </Button>
        )}
        {staff.role !== "owner" && (
          <Button
            type="button"
            className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 text-xs"
            onClick={handleRemove}
          >
            Remove
          </Button>
        )}
      </div>
    </li>
  );
});

interface StaffListProps {
  tenantId: string;
  onRemove: () => void;
}

export default function StaffList({ tenantId, onRemove }: StaffListProps) {
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ['tenant-staff', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const res = await fetch(`/api/tenants/${tenantId}/staff`);
      if (!res.ok) throw new Error('Failed to load staff');
      return res.json();
    },
    enabled: !!tenantId,
  });
  const { user } = useAuth();

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/tenants/${tenantId}/staff`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error('Remove failed');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-staff', tenantId] });
      onRemove?.();
    },
  });

  const roleMutation = useMutation({
    mutationFn: async (payload: { userId: string; newRole: string }) => {
      const res = await fetch(`/api/tenants/${tenantId}/staff`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: payload.userId, role: payload.newRole }),
      });
      if (!res.ok) throw new Error('Role change failed');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-staff', tenantId] });
      onRemove?.();
    },
  });

  const handleRemove = useCallback(
    (userId: string) => {
      if (!confirm('Remove this staff member?')) return;
      removeMutation.mutate(userId);
    },
    [removeMutation]
  );

  const handleRoleChange = useCallback(
    (userId: string, newRole: string) => {
      roleMutation.mutate({ userId, newRole });
    },
    [roleMutation]
  );

  if (isLoading) return <div>Loading staff...</div>;
  if (error) return <div className="text-red-500">Error loading staff.</div>;

  return (
    <div className="mt-8">
      <h2 className="text-lg font-bold mb-2">Staff Members</h2>
      <ul className="space-y-2">
        {data && data.length > 0 ? (
          data.map((staff: StaffMember) => (
            <StaffListItem
              key={staff.user_id}
              staff={staff}
              currentUserId={user?.id}
              onRemove={handleRemove}
              onRoleChange={handleRoleChange}
            />
          ))
        ) : (
          <li>No staff members found.</li>
        )}
      </ul>
    </div>
  );
}
