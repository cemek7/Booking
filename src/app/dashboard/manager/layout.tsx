import React from 'react';
import ManagerDashboardLayoutClient from '@/components/ManagerDashboardLayoutClient';

export const metadata = {
  title: 'Manager Dashboard | Booka',
  description: 'Manager operations dashboard'
};

export default function ManagerDashboardLayout({ children }: { children: React.ReactNode }) {
  return <ManagerDashboardLayoutClient>{children}</ManagerDashboardLayoutClient>;
}