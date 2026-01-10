'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Activity, DollarSign, Clock, Bell, Download, Users, TrendingUp, Database, Shield, Zap, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface KPITile {
  title: string;
  value: string | number;
  change?: string;
  status: 'good' | 'warning' | 'critical';
  icon: React.ReactNode;
}

interface TenantHealth {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'critical' | 'offline';
  lastActivity: string;
  bookingsToday: number;
  errorRate: number;
  responseTime: number;
  uptime: number;
}

interface PlatformMetrics {
  totalTenants: number;
  activeTenants: number;
  newTenants24h: number;
  totalBookings: number;
  bookings24h: number;
  revenue24h: number;
  avgResponseTime: number;
  errorRate: number;
  llmCostsToday: number;
  systemUptime: number;
}

interface OperationalMetric {
  name: string;
  current: number;
  threshold: number;
  status: 'normal' | 'warning' | 'critical';
}

interface Incident {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  service: string;
  startedAt: string;
  status: 'active' | 'investigating' | 'resolved';
  owner?: string;
}

interface BookingConflict {
  id: string;
  bookingIds: string[];
  resource: string;
  timeSlot: string;
  status: 'pending' | 'resolved';
  resolvedAt?: string;
}

interface PaymentMismatch {
  id: string;
  transactionId: string;
  internalAmount: number;
  pspAmount: number;
  delta: number;
  status: 'pending' | 'resolved';
}

interface DashboardData {
  platformMetrics: PlatformMetrics;
  kpis: KPITile[];
  operationalMetrics: OperationalMetric[];
  incidents: Incident[];
  bookingConflicts: BookingConflict[];
  paymentMismatches: PaymentMismatch[];
  tenantHealth: TenantHealth[];
  lastUpdated: string;
}

type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d';

export default function SuperAdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<string>('');

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/superadmin/dashboard?range=${timeRange}`);
      if (response.ok) {
        const dashboardData = await response.json();
        setData(dashboardData);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchDashboardData();
    }, 15000); // 15 seconds for live data

    return () => clearInterval(interval);
  }, [autoRefresh, fetchDashboardData]);

  const executeBulkAction = async () => {
    if (!bulkAction || selectedTenants.length === 0) return;
    
    try {
      const { authPost } = await import('@/lib/auth/auth-api-client');
      const response = await authPost('/api/superadmin/bulk-actions', {
        action: bulkAction,
        tenantIds: selectedTenants
      });
      
      if (!response.error) {
        await fetchDashboardData(); // Refresh data
        setSelectedTenants([]);
        setBulkAction('');
        alert(`Bulk ${bulkAction} completed successfully`);
      } else {
        alert(`Bulk ${bulkAction} failed`);
      }
    } catch (error) {
      console.error('Bulk action failed:', error);
      alert('Bulk action failed');
    }
  };

  const exportData = async () => {
    try {
      const response = await fetch(`/api/superadmin/export?range=${timeRange}&format=csv`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `superadmin-export-${timeRange}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'good':
      case 'normal':
      case 'healthy':
        return 'text-green-600';
      case 'warning':
      case 'degraded':
        return 'text-yellow-600';
      case 'critical':
        return 'text-red-600';
      case 'offline':
        return 'text-gray-600';
      default:
        return 'text-gray-600';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'good':
      case 'normal':
      case 'healthy':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'warning':
      case 'degraded':
        return <AlertCircle className="w-4 h-4 text-yellow-600" />;
      case 'critical':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'offline':
        return <XCircle className="w-4 h-4 text-gray-600" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-600" />;
    }
  };

  if (loading && !data) {
    return (
      <div className="p-6">
        <div className="text-center">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Platform Dashboard</h1>
          <p className="text-gray-600">Real-time platform monitoring and administration</p>
        </div>
        <div className="flex items-center gap-4">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as TimeRange)}
            className="border border-gray-300 rounded-md px-3 py-2"
          >
            <option value="1h">Last Hour</option>
            <option value="6h">Last 6 Hours</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
          <Button
            onClick={() => setAutoRefresh(!autoRefresh)}
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
          >
            {autoRefresh ? "Auto-refresh On" : "Auto-refresh Off"}
          </Button>
          <Button onClick={exportData} variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Platform Overview KPIs */}
      {data?.platformMetrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Active Tenants</p>
                  <p className="text-2xl font-bold">{data.platformMetrics.activeTenants}</p>
                  <p className="text-xs text-gray-500">of {data.platformMetrics.totalTenants} total</p>
                </div>
                <Users className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Bookings (24h)</p>
                  <p className="text-2xl font-bold">{data.platformMetrics.bookings24h}</p>
                  <p className="text-xs text-green-600">↗ +{((data.platformMetrics.bookings24h / data.platformMetrics.totalBookings) * 100).toFixed(1)}%</p>
                </div>
                <TrendingUp className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Revenue (24h)</p>
                  <p className="text-2xl font-bold">${data.platformMetrics.revenue24h.toLocaleString()}</p>
                  <p className="text-xs text-green-600">↗ Growing</p>
                </div>
                <DollarSign className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">System Uptime</p>
                  <p className="text-2xl font-bold">{data.platformMetrics.systemUptime}%</p>
                  <p className="text-xs text-gray-500">Last 30 days</p>
                </div>
                <Activity className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">LLM Costs Today</p>
                  <p className="text-2xl font-bold">${data.platformMetrics.llmCostsToday}</p>
                  <p className="text-xs text-yellow-600">Monitor closely</p>
                </div>
                <Zap className="w-8 h-8 text-yellow-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tenant Health Monitoring */}
      {data?.tenantHealth && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Tenant Health Monitoring
              <div className="flex items-center gap-2">
                {selectedTenants.length > 0 && (
                  <>
                    <select
                      value={bulkAction}
                      onChange={(e) => setBulkAction(e.target.value)}
                      className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                    >
                      <option value="">Select Action</option>
                      <option value="suspend">Suspend</option>
                      <option value="activate">Activate</option>
                      <option value="upgrade">Upgrade Plan</option>
                      <option value="reset_limits">Reset Limits</option>
                    </select>
                    <Button 
                      onClick={executeBulkAction} 
                      size="sm" 
                      disabled={!bulkAction}
                      className="bg-orange-600 hover:bg-orange-700"
                    >
                      Execute ({selectedTenants.length})
                    </Button>
                  </>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">
                      <input
                        type="checkbox"
                        checked={selectedTenants.length === data.tenantHealth.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedTenants(data.tenantHealth.map(t => t.id));
                          } else {
                            setSelectedTenants([]);
                          }
                        }}
                      />
                    </th>
                    <th className="text-left p-2">Tenant</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Bookings Today</th>
                    <th className="text-left p-2">Error Rate</th>
                    <th className="text-left p-2">Response Time</th>
                    <th className="text-left p-2">Uptime</th>
                    <th className="text-left p-2">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tenantHealth.map((tenant) => (
                    <tr key={tenant.id} className="border-b hover:bg-gray-50">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selectedTenants.includes(tenant.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTenants([...selectedTenants, tenant.id]);
                            } else {
                              setSelectedTenants(selectedTenants.filter(id => id !== tenant.id));
                            }
                          }}
                        />
                      </td>
                      <td className="p-2 font-medium">{tenant.name}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(tenant.status)}
                          <span className={getStatusColor(tenant.status)}>
                            {tenant.status.charAt(0).toUpperCase() + tenant.status.slice(1)}
                          </span>
                        </div>
                      </td>
                      <td className="p-2">{tenant.bookingsToday}</td>
                      <td className="p-2">
                        <span className={tenant.errorRate > 5 ? 'text-red-600' : tenant.errorRate > 2 ? 'text-yellow-600' : 'text-green-600'}>
                          {tenant.errorRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="p-2">
                        <span className={tenant.responseTime > 2000 ? 'text-red-600' : tenant.responseTime > 1000 ? 'text-yellow-600' : 'text-green-600'}>
                          {tenant.responseTime}ms
                        </span>
                      </td>
                      <td className="p-2">
                        <span className={tenant.uptime < 95 ? 'text-red-600' : tenant.uptime < 99 ? 'text-yellow-600' : 'text-green-600'}>
                          {tenant.uptime.toFixed(1)}%
                        </span>
                      </td>
                      <td className="p-2 text-gray-600">
                        {new Date(tenant.lastActivity).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
        return 'text-green-600 bg-green-50';
      case 'warning':
        return 'text-yellow-600 bg-yellow-50';
      case 'critical':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'low':
        return 'bg-blue-100 text-blue-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      case 'high':
        return 'bg-orange-100 text-orange-800';
      case 'critical':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const exportData = () => {
    if (!data) return;
    
    const exportData = {
      generated: new Date().toISOString(),
      timeRange,
      kpis: data.kpis,
      incidents: data.incidents,
      conflicts: data.bookingConflicts,
      mismatches: data.paymentMismatches
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `superadmin-dashboard-${timeRange}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Failed to load dashboard data</p>
        <Button onClick={fetchDashboardData} className="mt-4">Retry</Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Super Admin Dashboard</h1>
          <p className="text-gray-600">Real-time system health and business metrics</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex rounded-md shadow-sm">
            {(['1h', '6h', '24h', '7d', '30d'] as TimeRange[]).map((range) => (
              <Button
                key={range}
                variant={timeRange === range ? "default" : "outline"}
                size="sm"
                onClick={() => setTimeRange(range)}
                className="rounded-none first:rounded-l-md last:rounded-r-md"
              >
                {range}
              </Button>
            ))}
          </div>
          
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? "bg-green-600 hover:bg-green-700" : ""}
          >
            <Activity className="w-4 h-4 mr-2" />
            Auto Refresh {autoRefresh ? 'On' : 'Off'}
          </Button>
          
          <Button variant="outline" size="sm" onClick={exportData}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Row 1: Business KPIs */}
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-4">
        {data.kpis.map((kpi, index) => (
          <Card key={index} className="relative">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className={`p-2 rounded-md ${getStatusColor(kpi.status)}`}>
                    {kpi.icon}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">{kpi.value}</p>
                  {kpi.change && (
                    <p className={`text-sm ${kpi.change.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
                      {kpi.change}
                    </p>
                  )}
                </div>
              </div>
              <p className="text-sm font-medium text-gray-900 mt-2">{kpi.title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Row 2: Real-time Operational Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Operational Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.operationalMetrics.map((metric, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="font-medium">{metric.name}</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-lg font-bold">{metric.current}</span>
                    <span className="text-gray-500">/ {metric.threshold}</span>
                    <div className={`w-3 h-3 rounded-full ${
                      metric.status === 'normal' ? 'bg-green-500' :
                      metric.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                    }`}></div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Bell className="w-5 h-5 mr-2" />
              System Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span>Booking API</span>
                <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-sm">Online</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Payment System</span>
                <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-sm">Online</span>
              </div>
              <div className="flex items-center justify-between">
                <span>WhatsApp API</span>
                <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-sm">Online</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Database</span>
                <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-sm">Online</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Incidents & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Incidents */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2 text-red-500" />
              Active Incidents ({data.incidents.filter(i => i.status === 'active').length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.incidents.filter(i => i.status === 'active').map((incident) => (
                <div key={incident.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getSeverityColor(incident.severity)}`}>
                      {incident.severity.toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-500">{incident.startedAt}</span>
                  </div>
                  <p className="font-medium">{incident.title}</p>
                  <p className="text-sm text-gray-600">{incident.service}</p>
                  {incident.owner && <p className="text-xs text-gray-500">Owner: {incident.owner}</p>}
                </div>
              ))}
              {data.incidents.filter(i => i.status === 'active').length === 0 && (
                <p className="text-gray-500 text-center py-4">No active incidents</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Booking Conflicts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Clock className="w-5 h-5 mr-2 text-yellow-500" />
              Recent Booking Conflicts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.bookingConflicts.slice(0, 5).map((conflict) => (
                <div key={conflict.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-1 rounded text-xs ${conflict.status === 'resolved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {conflict.status.toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-500">{conflict.timeSlot}</span>
                  </div>
                  <p className="font-medium">{conflict.resource}</p>
                  <p className="text-sm text-gray-600">Bookings: {conflict.bookingIds.join(', ')}</p>
                </div>
              ))}
              {data.bookingConflicts.length === 0 && (
                <p className="text-gray-500 text-center py-4">No booking conflicts</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Payment Mismatches */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <DollarSign className="w-5 h-5 mr-2 text-orange-500" />
              Payment Mismatches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.paymentMismatches.slice(0, 5).map((mismatch) => (
                <div key={mismatch.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-1 rounded text-xs ${mismatch.status === 'resolved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {mismatch.status.toUpperCase()}
                    </span>
                    <span className="text-lg font-bold text-red-600">
                      ${Math.abs(mismatch.delta / 100).toFixed(2)}
                    </span>
                  </div>
                  <p className="font-medium">TX: {mismatch.transactionId}</p>
                  <div className="text-sm text-gray-600">
                    <p>Internal: ${(mismatch.internalAmount / 100).toFixed(2)}</p>
                    <p>PSP: ${(mismatch.pspAmount / 100).toFixed(2)}</p>
                  </div>
                </div>
              ))}
              {data.paymentMismatches.length === 0 && (
                <p className="text-gray-500 text-center py-4">No payment mismatches</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <div className="text-center text-sm text-gray-500">
        Last updated: {data.lastUpdated} • Auto-refresh: {autoRefresh ? 'On' : 'Off'}
      </div>
    </div>
  );
}