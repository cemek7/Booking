import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/components/ui/use-toast';
import {
  Calendar,
  Link,
  Unlink,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Settings,
  Users,
  Clock,
  Zap
} from 'lucide-react';

interface CalendarIntegration {
  id: string;
  calendar_name: string;
  calendar_email: string;
  sync_enabled: boolean;
  conflict_resolution: 'block' | 'override' | 'notify';
  sync_direction: 'bidirectional' | 'to_google' | 'from_google';
  last_synced: string | null;
  sync_errors: string | null;
  staff_id: string | null;
}

interface CalendarSettingsProps {
  tenantId: string;
  userRole: 'owner' | 'admin' | 'manager' | 'staff';
  currentUserId?: string;
}

const CalendarSettings: React.FC<CalendarSettingsProps> = ({
  tenantId,
  userRole,
  currentUserId
}) => {
  const [integrations, setIntegrations] = useState<CalendarIntegration[]>([]);
  const [staffMembers, setStaffMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    loadCalendarIntegrations();
    loadStaffMembers();
  }, [tenantId]);

  const loadCalendarIntegrations = async () => {
    try {
      const response = await fetch(`/api/calendar/integrations?tenant_id=${tenantId}`);
      if (response.ok) {
        const data = await response.json();
        setIntegrations(data.integrations || []);
      }
    } catch (error) {
      console.error('Failed to load calendar integrations:', error);
      toast({
        title: 'Error',
        description: 'Failed to load calendar integrations',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadStaffMembers = async () => {
    try {
      const response = await fetch(`/api/staff?tenant_id=${tenantId}`);
      if (response.ok) {
        const data = await response.json();
        setStaffMembers(data.staff || []);
      }
    } catch (error) {
      console.error('Failed to load staff members:', error);
    }
  };

  const connectCalendar = async (staffId?: string) => {
    setConnecting(true);
    try {
      const params = new URLSearchParams({
        tenant_id: tenantId,
        return_url: window.location.href
      });

      if (staffId) {
        params.append('staff_id', staffId);
      }

      const response = await fetch(`/api/calendar/auth?${params}`);
      if (response.ok) {
        const data = await response.json();
        window.location.href = data.authorization_url;
      } else {
        throw new Error('Failed to initiate calendar connection');
      }
    } catch (error) {
      console.error('Failed to connect calendar:', error);
      toast({
        title: 'Error',
        description: 'Failed to connect Google Calendar',
        variant: 'destructive'
      });
    } finally {
      setConnecting(false);
    }
  };

  const disconnectCalendar = async (integrationId: string) => {
    try {
      const response = await fetch(`/api/calendar/integrations/${integrationId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadCalendarIntegrations();
        toast({
          title: 'Success',
          description: 'Calendar disconnected successfully'
        });
      } else {
        throw new Error('Failed to disconnect calendar');
      }
    } catch (error) {
      console.error('Failed to disconnect calendar:', error);
      toast({
        title: 'Error',
        description: 'Failed to disconnect calendar',
        variant: 'destructive'
      });
    }
  };

  const syncNow = async (integrationId: string) => {
    setSyncing(integrationId);
    try {
      const response = await fetch(`/api/calendar/sync/${integrationId}`, {
        method: 'POST'
      });

      if (response.ok) {
        const result = await response.json();
        await loadCalendarIntegrations();
        
        toast({
          title: 'Sync Complete',
          description: `Synced ${result.events_synced} events${result.conflicts_detected > 0 ? `, ${result.conflicts_detected} conflicts detected` : ''}`
        });
      } else {
        throw new Error('Sync failed');
      }
    } catch (error) {
      console.error('Sync failed:', error);
      toast({
        title: 'Error',
        description: 'Calendar sync failed',
        variant: 'destructive'
      });
    } finally {
      setSyncing(null);
    }
  };

  const updateIntegrationSettings = async (
    integrationId: string,
    settings: Partial<CalendarIntegration>
  ) => {
    try {
      const response = await fetch(`/api/calendar/integrations/${integrationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      if (response.ok) {
        await loadCalendarIntegrations();
        toast({
          title: 'Success',
          description: 'Calendar settings updated'
        });
      } else {
        throw new Error('Failed to update settings');
      }
    } catch (error) {
      console.error('Failed to update settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to update calendar settings',
        variant: 'destructive'
      });
    }
  };

  const getStaffName = (staffId: string | null) => {
    if (!staffId) return 'Tenant Calendar';
    const staff = staffMembers.find(s => s.id === staffId);
    return staff ? staff.name : 'Unknown Staff';
  };

  const getStatusColor = (integration: CalendarIntegration) => {
    if (integration.sync_errors) return 'bg-red-100 text-red-800';
    if (!integration.sync_enabled) return 'bg-gray-100 text-gray-800';
    if (!integration.last_synced) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
  };

  const getStatusText = (integration: CalendarIntegration) => {
    if (integration.sync_errors) return 'Error';
    if (!integration.sync_enabled) return 'Disabled';
    if (!integration.last_synced) return 'Pending';
    return 'Active';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-purple-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center">
            <Calendar className="h-6 w-6 mr-2 text-purple-600" />
            Calendar Integration
          </h2>
          <p className="text-gray-600">Sync bookings with Google Calendar</p>
        </div>
        
        {(userRole === 'owner' || userRole === 'admin') && (
          <Button onClick={() => connectCalendar()} disabled={connecting}>
            {connecting ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Link className="h-4 w-4 mr-2" />
            )}
            Connect Calendar
          </Button>
        )}
      </div>

      {/* Integration Status */}
      {integrations.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Calendar className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-medium mb-2">No Calendar Connected</h3>
            <p className="text-gray-600 mb-6">
              Connect your Google Calendar to automatically sync bookings and prevent conflicts
            </p>
            <Button onClick={() => connectCalendar()}>
              <Link className="h-4 w-4 mr-2" />
              Connect Google Calendar
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {integrations.map((integration) => (
            <Card key={integration.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Calendar className="h-5 w-5 text-purple-600" />
                    <div>
                      <CardTitle className="text-lg">{integration.calendar_name}</CardTitle>
                      <p className="text-sm text-gray-600">{getStaffName(integration.staff_id)}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge className={getStatusColor(integration)}>
                      {getStatusText(integration)}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncNow(integration.id)}
                      disabled={syncing === integration.id}
                    >
                      {syncing === integration.id ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Sync Errors */}
                {integration.sync_errors && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Sync Error:</strong> {integration.sync_errors}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Settings */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Sync Enabled</label>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={integration.sync_enabled}
                        onCheckedChange={(checked) =>
                          updateIntegrationSettings(integration.id, { sync_enabled: checked })
                        }
                      />
                      <span className="text-sm text-gray-600">
                        {integration.sync_enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Sync Direction</label>
                    <Select
                      value={integration.sync_direction}
                      onValueChange={(value: any) =>
                        updateIntegrationSettings(integration.id, { sync_direction: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bidirectional">
                          <div className="flex items-center">
                            <Zap className="h-4 w-4 mr-2" />
                            Bidirectional
                          </div>
                        </SelectItem>
                        <SelectItem value="to_google">
                          <div className="flex items-center">
                            <Calendar className="h-4 w-4 mr-2" />
                            To Google Only
                          </div>
                        </SelectItem>
                        <SelectItem value="from_google">
                          <div className="flex items-center">
                            <Users className="h-4 w-4 mr-2" />
                            From Google Only
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Conflict Resolution</label>
                    <Select
                      value={integration.conflict_resolution}
                      onValueChange={(value: any) =>
                        updateIntegrationSettings(integration.id, { conflict_resolution: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="notify">
                          <div className="flex items-center">
                            <AlertTriangle className="h-4 w-4 mr-2" />
                            Notify Only
                          </div>
                        </SelectItem>
                        <SelectItem value="block">
                          <div className="flex items-center">
                            <Settings className="h-4 w-4 mr-2" />
                            Block Booking
                          </div>
                        </SelectItem>
                        <SelectItem value="override">
                          <div className="flex items-center">
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Override Calendar
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Last Sync Info */}
                {integration.last_synced && (
                  <div className="text-sm text-gray-600">
                    <Clock className="h-4 w-4 inline mr-1" />
                    Last synced: {new Date(integration.last_synced).toLocaleString()}
                  </div>
                )}

                <Separator />

                {/* Actions */}
                <div className="flex justify-end space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => disconnectCalendar(integration.id)}
                  >
                    <Unlink className="h-4 w-4 mr-2" />
                    Disconnect
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Staff Calendar Connections */}
      {(userRole === 'owner' || userRole === 'admin') && staffMembers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Users className="h-5 w-5 mr-2" />
              Staff Calendar Connections
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {staffMembers.map((staff) => {
                const staffIntegration = integrations.find(i => i.staff_id === staff.id);
                
                return (
                  <div key={staff.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                        <span className="font-medium text-purple-600">
                          {staff.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium">{staff.name}</div>
                        <div className="text-sm text-gray-600">{staff.email}</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      {staffIntegration ? (
                        <Badge className={getStatusColor(staffIntegration)}>
                          Connected
                        </Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => connectCalendar(staff.id)}
                        >
                          <Link className="h-4 w-4 mr-2" />
                          Connect
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CalendarSettings;