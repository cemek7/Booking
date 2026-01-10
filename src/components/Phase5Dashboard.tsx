'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import { authFetch, authPost } from '@/lib/auth/auth-api-client';
import { 
  Brain,
  Package,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Clock,
  Users,
  Settings,
  CheckCircle
} from 'lucide-react';

interface VerticalModule {
  id: string;
  name: string;
  version: string;
  description: string;
  vertical: 'beauty' | 'hospitality' | 'medicine';
  isActive: boolean;
}

interface MLPrediction {
  type: string;
  data: {
    time_slot?: string;
    probability_score?: number;
    service_name?: string;
    revenue_impact?: number;
  }[];
  success?: boolean;
  generated_at: string;
}

interface AnomalyDetection {
  id: string;
  timestamp: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  score: number;
}

interface Phase5DashboardProps {
  tenantId: string;
  userRole?: string;
}

const Phase5Dashboard: React.FC<Phase5DashboardProps> = ({ tenantId, userRole = 'admin' }) => {
  const [activeModules, setActiveModules] = useState<VerticalModule[]>([]);
  const [availableModules, setAvailableModules] = useState<VerticalModule[]>([]);
  const [mlPredictions, setMLPredictions] = useState<Record<string, MLPrediction>>({});
  const [anomalies, setAnomalies] = useState<AnomalyDetection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Load modules data
      const modulesRes = await authFetch('/api/modules');
      const modulesData = modulesRes.data;

      if (modulesData?.success) {
        setActiveModules(modulesData.active || []);
        // Get available modules for all verticals
        const [beautyRes, hospitalityRes, medicineRes] = await Promise.all([
          authFetch('/api/modules?vertical=beauty'),
          authFetch('/api/modules?vertical=hospitality'),
          authFetch('/api/modules?vertical=medicine')
        ]);

        const [beautyData, hospitalityData, medicineData] = [
          beautyRes.data,
          hospitalityRes.data,
          medicineRes.data
        ];

        const allAvailable = [
          ...(beautyData.modules || []),
          ...(hospitalityData.modules || []),
          ...(medicineData.modules || [])
        ];

        setAvailableModules(allAvailable);
      }

      // Load ML predictions
      const [schedulingRes, anomaliesRes, pricingRes] = await Promise.all([
        authFetch('/api/ml/predictions?type=scheduling'),
        authFetch('/api/ml/predictions?type=anomalies'),
        authFetch('/api/ml/predictions?type=pricing')
      ]);

      const [schedulingData, anomaliesData, pricingData] = [
        schedulingRes.data,
        anomaliesRes.data,
        pricingRes.data
      ];

      setMLPredictions({
        scheduling: schedulingData.success ? schedulingData : null,
        anomalies: anomaliesData.success ? anomaliesData : null,
        pricing: pricingData.success ? pricingData : null,
      });

      if (anomaliesData.success) {
        setAnomalies(anomaliesData.data || []);
      }

    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleModuleToggle = async (moduleId: string, enable: boolean) => {
    try {
      const response = await authPost('/api/modules', {
        action: enable ? 'install' : 'uninstall',
        moduleId,
      });

      const result = response.data;

      if (result.success) {
        await loadDashboardData(); // Reload data
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'text-red-500 bg-red-50';
      case 'medium': return 'text-yellow-500 bg-yellow-50';
      case 'low': return 'text-blue-500 bg-blue-50';
      default: return 'text-gray-500 bg-gray-50';
    }
  };

  const getVerticalIcon = (vertical: string) => {
    switch (vertical) {
      case 'beauty': return '💅';
      case 'hospitality': return '🏨';
      case 'medicine': return '🏥';
      default: return '📦';
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-6 bg-gray-200 rounded w-1/2"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Phase 5 Advanced Features</h1>
          <p className="text-muted-foreground">
            Analytics, Vertical Modules, and Machine Learning Integration
          </p>
        </div>
        <Button onClick={loadDashboardData} variant="outline">
          Refresh All
        </Button>
      </div>

      {error && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Package className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Modules</p>
                <p className="text-2xl font-bold">{activeModules.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Brain className="h-5 w-5 text-purple-500" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">ML Predictions</p>
                <p className="text-2xl font-bold">
                  {Object.values(mlPredictions).filter(p => p?.success).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Anomalies</p>
                <p className="text-2xl font-bold">{anomalies.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Optimization Score</p>
                <p className="text-2xl font-bold">87%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="analytics" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="analytics">Analytics Dashboard</TabsTrigger>
          <TabsTrigger value="modules">Vertical Modules</TabsTrigger>
          <TabsTrigger value="ml">ML Predictions</TabsTrigger>
          <TabsTrigger value="anomalies">Anomaly Detection</TabsTrigger>
        </TabsList>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          <AnalyticsDashboard 
            tenantId={tenantId} 
            userRole={(userRole as 'staff' | 'manager' | 'owner' | 'superadmin') || 'manager'} 
            userId="current-user-id" 
          />
        </TabsContent>

        {/* Vertical Modules Tab */}
        <TabsContent value="modules" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableModules.map((module) => {
              const isActive = activeModules.some(am => am.id === module.id);
              
              return (
                <Card key={module.id} className={isActive ? 'border-green-200 bg-green-50' : ''}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="text-2xl">{getVerticalIcon(module.vertical)}</span>
                        <div>
                          <CardTitle className="text-lg">{module.name}</CardTitle>
                          <p className="text-sm text-muted-foreground">
                            v{module.version} • {module.vertical}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={isActive ? "default" : "outline"}
                        onClick={() => handleModuleToggle(module.id, !isActive)}
                        className={isActive ? "bg-green-600 hover:bg-green-700" : ""}
                      >
                        {isActive ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3">
                      {module.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <Badge variant={isActive ? 'default' : 'secondary'}>
                        {isActive ? 'Active' : 'Available'}
                      </Badge>
                      {isActive && (
                        <Button size="sm" variant="outline">
                          <Settings className="h-4 w-4 mr-2" />
                          Configure
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Active Module Features */}
          {activeModules.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Active Module Features</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {activeModules.map((module) => (
                    <div key={module.id} className="border rounded-lg p-4">
                      <h4 className="font-medium mb-2 flex items-center">
                        <span className="mr-2">{getVerticalIcon(module.vertical)}</span>
                        {module.name}
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {/* Mock features - would come from module definition */}
                        <Badge variant="outline">Booking Flow</Badge>
                        <Badge variant="outline">Client Management</Badge>
                        <Badge variant="outline">Analytics</Badge>
                        <Badge variant="outline">Payments</Badge>
                        <Badge variant="outline">Notifications</Badge>
                        <Badge variant="outline">Reporting</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ML Predictions Tab */}
        <TabsContent value="ml" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Scheduling Predictions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Clock className="h-5 w-5 mr-2" />
                  Scheduling Optimization
                </CardTitle>
              </CardHeader>
              <CardContent>
                {mlPredictions.scheduling?.success ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Found {mlPredictions.scheduling.data?.length || 0} optimized time slots
                    </p>
                    <div className="space-y-2">
                      {(mlPredictions.scheduling.data || []).slice(0, 3).map((prediction, index: number) => {
                        const timeSlot = prediction.time_slot;
                        const score = prediction.probability_score;
                        if (!timeSlot || score === undefined) return null;
                        
                        return (
                          <div key={index} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                            <span className="text-sm">
                              {new Date(timeSlot).toLocaleTimeString()}
                            </span>
                            <Badge variant="outline">
                              {Math.round(score * 100)}% optimal
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No scheduling data available</p>
                )}
              </CardContent>
            </Card>

            {/* Pricing Optimization */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <DollarSign className="h-5 w-5 mr-2" />
                  Pricing Optimization
                </CardTitle>
              </CardHeader>
              <CardContent>
                {mlPredictions.pricing?.success ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {mlPredictions.pricing.data?.length || 0} services analyzed
                    </p>
                    <div className="space-y-2">
                      {(mlPredictions.pricing.data || []).slice(0, 3).map((optimization, index: number) => {
                        const serviceName = optimization.service_name;
                        const revenueImpact = optimization.revenue_impact;
                        if (!serviceName || revenueImpact === undefined) return null;
                        
                        return (
                          <div key={index} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                            <span className="text-sm">{serviceName}</span>
                            <Badge variant={revenueImpact > 0 ? 'default' : 'secondary'}>
                              {revenueImpact > 0 ? '+' : ''}{revenueImpact}% revenue
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No pricing data available</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Customer Insights */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Users className="h-5 w-5 mr-2" />
                Customer Intelligence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-4 bg-blue-50 rounded">
                  <p className="text-2xl font-bold text-blue-600">78%</p>
                  <p className="text-sm text-muted-foreground">Customer Retention Rate</p>
                </div>
                <div className="text-center p-4 bg-green-50 rounded">
                  <p className="text-2xl font-bold text-green-600">$1,250</p>
                  <p className="text-sm text-muted-foreground">Avg Customer LTV</p>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded">
                  <p className="text-2xl font-bold text-purple-600">23%</p>
                  <p className="text-sm text-muted-foreground">Churn Risk</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Anomaly Detection Tab */}
        <TabsContent value="anomalies" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center">
                  <AlertTriangle className="h-5 w-5 mr-2" />
                  Detected Anomalies
                </span>
                <Badge variant="outline">{anomalies.length} active</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {anomalies.length > 0 ? (
                <div className="space-y-4">
                  {anomalies.map((anomaly) => (
                    <div key={anomaly.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <Badge className={getSeverityColor(anomaly.severity)}>
                              {anomaly.severity.toUpperCase()}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {anomaly.type.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="font-medium mb-1">{anomaly.description}</p>
                          <p className="text-sm text-muted-foreground">
                            Detected: {new Date(anomaly.timestamp).toLocaleString()}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Confidence: {Math.round(anomaly.score * 100)}%
                          </p>
                        </div>
                        <div className="flex space-x-2">
                          <Button size="sm" variant="outline">
                            Investigate
                          </Button>
                          <Button size="sm" variant="outline">
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
                  <p className="text-lg font-medium">No anomalies detected</p>
                  <p className="text-muted-foreground">Your system is operating normally</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Phase5Dashboard;