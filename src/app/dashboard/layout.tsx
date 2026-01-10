import React from 'react';
import DashboardLayoutClient from '@/components/DashboardLayoutClient';

export const metadata = {
  title: 'Dashboard | Booka',
  description: 'Manage your business dashboard'
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
}
