'use client';
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Users, 
  Calendar, 
  DollarSign, 
  TrendingUp, 
  Settings, 
  Zap, 
  AlertTriangle, 
  Clock, 
  CheckCircle,
  Plus,
  Edit3,
  Eye
} from 'lucide-react';

interface OwnerDashboardClientProps {
  user: { 
    id: string; 
    email: string; 
    role: 'owner' | 'superadmin';
    tenant_id?: string;
  };
}

interface TenantMetrics {
  totalBookings: number;
  bookingsToday: number;
  revenue30Days: number;
  revenueToday: number;
  activeStaff: number;
  totalCustomers: number;
  averageRating: number;
  conversionRate: number;
  llmUsage: {
    tokensUsed: number;
    tokenLimit: number;
    costThisMonth: number;
    percentageUsed: number;
  };
  upcomingBookings: Array<{
    id: string;
    customerName: string;
    service: string;
    startTime: string;
    staff: string;
    status: string;
  }>;
}

interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: 'staff' | 'manager';
  status: 'active' | 'inactive';
  bookingsToday: number;
  rating: number;
  joinedAt: string;
}

interface TenantSettings {
  name: string;
  industry: 'beauty' | 'hospitality' | 'medicine';
  timezone: string;
  currency: string;
  workingHours: {
    monday: { start: string; end: string; closed: boolean };
    tuesday: { start: string; end: string; closed: boolean };
    wednesday: { start: string; end: string; closed: boolean };
    thursday: { start: string; end: string; closed: boolean };
    friday: { start: string; end: string; closed: boolean };
    saturday: { start: string; end: string; closed: boolean };
    sunday: { start: string; end: string; closed: boolean };
  };
  modules: {
    beauty?: boolean;
    hospitality?: boolean;
    medicine?: boolean;
  };
  llmSettings: {
    premiumEnabled: boolean;
    monthlyBudget: number;
    alertThreshold: number;
  };
}

export default function OwnerDashboardClient({ user }: OwnerDashboardClientProps) {
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'staff' | 'settings' | 'modules'>('dashboard');
  const [metrics, setMetrics] = useState<TenantMetrics | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const tenantId = user.tenant_id; // For superadmin, this might be selected dynamically

  useEffect(() => {
    if (tenantId) {
      fetchDashboardData();
    }
  }, [tenantId]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [metricsRes, staffRes, settingsRes] = await Promise.all([
        fetch(`/api/owner/metrics?tenant_id=${tenantId}`),
        fetch(`/api/owner/staff?tenant_id=${tenantId}`),
        fetch(`/api/owner/settings?tenant_id=${tenantId}`)
      ]);

      if (metricsRes.ok) {
        const metricsData = await metricsRes.json();
        setMetrics(metricsData);
      }

      if (staffRes.ok) {
        const staffData = await staffRes.json();
        setStaff(staffData);
      }

      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        setSettings(settingsData);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInviteStaff = async () => {
    const email = prompt('Enter staff email address:');
    const role = confirm('Is this a manager? (OK for manager, Cancel for staff)') ? 'manager' : 'staff';
    
    if (email) {
      try {
        const response = await fetch('/api/owner/staff/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            email, 
            role, 
            tenant_id: tenantId 
          })
        });
        
        if (response.ok) {
          alert('Staff invitation sent successfully!');
          fetchDashboardData(); // Refresh data
        } else {
          alert('Failed to send invitation');
        }
      } catch (error) {
        console.error('Invite failed:', error);
        alert('Invitation failed');
      }
    }
  };

  const handleModuleToggle = async (module: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/owner/modules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tenant_id: tenantId,
          module,
          enabled 
        })
      });
      
      if (response.ok) {
        await fetchDashboardData(); // Refresh settings
      }
    } catch (error) {
      console.error('Module toggle failed:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
          <p className="mt-4">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <div className="bg-white border-b">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {user.role === 'superadmin' ? 'Platform Management' : 'Business Dashboard'}
              </h1>
              <p className="text-gray-600">
                {settings?.name || 'Your Business'} • {user.role === 'superadmin' ? 'Super Admin' : 'Owner'}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Button onClick={() => fetchDashboardData()} variant="outline" size="sm">
                Refresh
              </Button>
            </div>
          </div>
          
          <div className="flex space-x-8">
            {['dashboard', 'staff', 'settings', 'modules'].map((tab) => (
              <button
                key={tab}
                onClick={() => setCurrentTab(tab as any)}
                className={`pb-2 px-1 border-b-2 font-medium text-sm capitalize ${
                  currentTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="p-6">
        {currentTab === 'dashboard' && metrics && (
          <div className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Today's Bookings</p>
                      <p className="text-2xl font-bold">{metrics.bookingsToday}</p>
                      <p className="text-xs text-gray-500">{metrics.totalBookings} total</p>
                    </div>
                    <Calendar className="w-8 h-8 text-blue-600" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Revenue (30d)</p>
                      <p className="text-2xl font-bold">${metrics.revenue30Days.toLocaleString()}</p>
                      <p className="text-xs text-green-600">${metrics.revenueToday} today</p>
                    </div>
                    <DollarSign className="w-8 h-8 text-green-600" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Active Staff</p>
                      <p className="text-2xl font-bold">{metrics.activeStaff}</p>
                      <p className="text-xs text-gray-500">team members</p>
                    </div>
                    <Users className="w-8 h-8 text-purple-600" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Conversion Rate</p>
                      <p className="text-2xl font-bold">{metrics.conversionRate}%</p>
                      <p className="text-xs text-green-600">↗ Improving</p>
                    </div>
                    <TrendingUp className="w-8 h-8 text-green-600" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* LLM Usage Monitor */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5" />
                  AI Usage & Billing
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Tokens Used This Month</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            metrics.llmUsage.percentageUsed > 90 ? 'bg-red-500' : 
                            metrics.llmUsage.percentageUsed > 70 ? 'bg-yellow-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(metrics.llmUsage.percentageUsed, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium">{metrics.llmUsage.percentageUsed}%</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {metrics.llmUsage.tokensUsed.toLocaleString()} / {metrics.llmUsage.tokenLimit.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Cost This Month</p>
                    <p className="text-xl font-bold">${metrics.llmUsage.costThisMonth}</p>
                  </div>
                  <div>
                    {metrics.llmUsage.percentageUsed > 80 && (
                      <div className="flex items-center gap-2 text-yellow-600">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-sm">Approaching limit</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Upcoming Bookings */}
            <Card>
              <CardHeader>
                <CardTitle>Today's Upcoming Bookings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {metrics.upcomingBookings.map((booking) => (
                    <div key={booking.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 text-gray-500" />
                        <div>
                          <p className="font-medium">{booking.customerName}</p>
                          <p className="text-sm text-gray-600">{booking.service} with {booking.staff}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{new Date(booking.startTime).toLocaleTimeString()}</p>
                        <span className={`text-xs px-2 py-1 rounded ${
                          booking.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {booking.status}
                        </span>
                      </div>
                    </div>
                  ))}
                  {metrics.upcomingBookings.length === 0 && (
                    <p className="text-center text-gray-500 py-4">No upcoming bookings today</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {currentTab === 'staff' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Team Management</h2>
              <Button onClick={handleInviteStaff}>
                <Plus className="w-4 h-4 mr-2" />
                Invite Staff
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-4">Name</th>
                      <th className="text-left p-4">Role</th>
                      <th className="text-left p-4">Status</th>
                      <th className="text-left p-4">Today's Bookings</th>
                      <th className="text-left p-4">Rating</th>
                      <th className="text-left p-4">Joined</th>
                      <th className="text-left p-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((member) => (
                      <tr key={member.id} className="border-t">
                        <td className="p-4">
                          <div>
                            <p className="font-medium">{member.name}</p>
                            <p className="text-sm text-gray-600">{member.email}</p>
                          </div>
                        </td>
                        <td className="p-4 capitalize">{member.role}</td>
                        <td className="p-4">
                          <span className={`px-2 py-1 rounded text-xs ${
                            member.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                          }`}>
                            {member.status}
                          </span>
                        </td>
                        <td className="p-4">{member.bookingsToday}</td>
                        <td className="p-4">★ {member.rating.toFixed(1)}</td>
                        <td className="p-4">{new Date(member.joinedAt).toLocaleDateString()}</td>
                        <td className="p-4">
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline">
                              <Eye className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline">
                              <Edit3 className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        )}

        {currentTab === 'settings' && settings && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Business Settings</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Basic Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Business Name</label>
                    <input 
                      type="text" 
                      value={settings.name} 
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Industry</label>
                    <select value={settings.industry} className="w-full border rounded-md px-3 py-2">
                      <option value="beauty">Beauty & Wellness</option>
                      <option value="hospitality">Hospitality</option>
                      <option value="medicine">Healthcare</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Timezone</label>
                      <select value={settings.timezone} className="w-full border rounded-md px-3 py-2">
                        <option value="America/New_York">Eastern Time</option>
                        <option value="America/Chicago">Central Time</option>
                        <option value="America/Los_Angeles">Pacific Time</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Currency</label>
                      <select value={settings.currency} className="w-full border rounded-md px-3 py-2">
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="GBP">GBP (£)</option>
                      </select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>AI Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Premium AI Features</p>
                      <p className="text-sm text-gray-600">Enable advanced AI capabilities</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={settings.llmSettings.premiumEnabled}
                      className="rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Monthly AI Budget</label>
                    <input 
                      type="number" 
                      value={settings.llmSettings.monthlyBudget}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Alert Threshold (%)</label>
                    <input 
                      type="number" 
                      value={settings.llmSettings.alertThreshold}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {currentTab === 'modules' && settings && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Feature Modules</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Beauty Module
                    <input 
                      type="checkbox" 
                      checked={settings.modules.beauty || false}
                      onChange={(e) => handleModuleToggle('beauty', e.target.checked)}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1 text-gray-600">
                    <li>• Stylist portfolio management</li>
                    <li>• Client preference tracking</li>
                    <li>• Treatment history</li>
                    <li>• Product recommendations</li>
                    <li>• Before/after galleries</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Hospitality Module
                    <input 
                      type="checkbox" 
                      checked={settings.modules.hospitality || false}
                      onChange={(e) => handleModuleToggle('hospitality', e.target.checked)}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1 text-gray-600">
                    <li>• Guest management</li>
                    <li>• Special requests tracking</li>
                    <li>• Group bookings</li>
                    <li>• Event planning</li>
                    <li>• Feedback collection</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Medical Module
                    <input 
                      type="checkbox" 
                      checked={settings.modules.medicine || false}
                      onChange={(e) => handleModuleToggle('medicine', e.target.checked)}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1 text-gray-600">
                    <li>• Patient consent management</li>
                    <li>• Secure communications</li>
                    <li>• Compliance tracking</li>
                    <li>• Results delivery</li>
                    <li>• Follow-up scheduling</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}