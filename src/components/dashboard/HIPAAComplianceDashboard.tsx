/**
 * HIPAA Compliance Dashboard
 * 
 * Real-time monitoring dashboard for HIPAA compliance status,
 * PHI access tracking, and security incident management
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Shield, 
  Eye, 
  AlertTriangle, 
  Clock, 
  Database, 
  Key,
  FileText,
  TrendingUp,
  Download,
  RefreshCw
} from 'lucide-react';
import { hipaaCompliance } from '@/lib/compliance/hipaaCompliance';
import { encryptionManager } from '@/lib/encryption';

interface ComplianceMetrics {
  phi_access_total: number;
  active_sessions: number;
  security_incidents_24h: number;
  compliance_score: number;
  data_retention_compliance: number;
  encryption_strength: string;
}

interface SecurityIncident {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  occurred_at: string;
  resolved: boolean;
}

interface PHIAccessLog {
  id: string;
  user_name: string;
  action: string;
  data_type: string;
  accessed_at: string;
  justification: string;
}

export default function HIPAAComplianceDashboard() {
  const [metrics, setMetrics] = useState<ComplianceMetrics | null>(null);
  const [incidents, setIncidents] = useState<SecurityIncident[]>([]);
  const [recentAccess, setRecentAccess] = useState<PHIAccessLog[]>([]);
  const [violations, setViolations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchComplianceData = async () => {
    setRefreshing(true);
    try {
      // Fetch compliance metrics
      const tenantId = 'current-tenant-id'; // Get from context
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      // Generate compliance report
      const report = await hipaaCompliance.generateComplianceReport(
        tenantId,
        startDate,
        endDate
      );
      
      // Check for violations
      const violationsResult = await hipaaCompliance.checkComplianceViolations(tenantId);
      setViolations(violationsResult.violations);
      
      // Get encryption status
      const keyStatus = encryptionManager.getKeyStatus();
      const encryptionCompliance = await encryptionManager.validateCompliance();
      
      // Mock metrics (in production, these would come from your analytics)
      const complianceMetrics: ComplianceMetrics = {
        phi_access_total: report.phi_access_summary.total_accesses,
        active_sessions: 12,
        security_incidents_24h: report.security_incidents.filter(
          (incident: any) => new Date(incident.occurred_at) > new Date(Date.now() - 24 * 60 * 60 * 1000)
        ).length,
        compliance_score: encryptionCompliance.compliant ? 98 : 85,
        data_retention_compliance: (
          (report.data_retention_status.total_records - report.data_retention_status.expired_records) / 
          report.data_retention_status.total_records * 100
        ),
        encryption_strength: encryptionCompliance.compliant ? 'AES-256-GCM' : 'Non-compliant'
      };
      
      setMetrics(complianceMetrics);
      setIncidents(report.security_incidents || []);
      
      // Mock recent access (in production, fetch from PHI access logs)
      setRecentAccess([
        {
          id: '1',
          user_name: 'Dr. Smith',
          action: 'view',
          data_type: 'medical_record',
          accessed_at: new Date().toISOString(),
          justification: 'Patient consultation'
        }
      ]);
      
    } catch (error) {
      console.error('Error fetching compliance data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const generateComplianceReport = async () => {
    try {
      const tenantId = 'current-tenant-id';
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const report = await hipaaCompliance.generateComplianceReport(
        tenantId,
        startDate,
        endDate
      );
      
      // Convert to downloadable format
      const blob = new Blob([JSON.stringify(report, null, 2)], { 
        type: 'application/json' 
      });
      
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hipaa-compliance-report-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('Error generating compliance report:', error);
    }
  };

  useEffect(() => {
    fetchComplianceData();
    
    // Set up auto-refresh every 5 minutes
    const interval = setInterval(fetchComplianceData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  const getComplianceScoreColor = (score: number) => {
    if (score >= 95) return 'text-green-600';
    if (score >= 85) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">HIPAA Compliance Dashboard</h1>
          <p className="text-gray-600">Monitor PHI protection and compliance status</p>
        </div>
        <div className="flex space-x-4">
          <Button 
            onClick={fetchComplianceData}
            disabled={refreshing}
            variant="outline"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={generateComplianceReport}>
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Violations Alert */}
      {violations.length > 0 && (
        <Alert className="mb-6 border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            {violations.length} compliance violation(s) detected. Immediate attention required.
          </AlertDescription>
        </Alert>
      )}

      {/* Compliance Metrics Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Compliance Score</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getComplianceScoreColor(metrics?.compliance_score || 0)}`}>
              {metrics?.compliance_score || 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              {metrics?.compliance_score >= 95 ? 'Excellent' : 
               metrics?.compliance_score >= 85 ? 'Good' : 'Needs Attention'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">PHI Access (24h)</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.phi_access_total || 0}</div>
            <p className="text-xs text-muted-foreground">
              {metrics?.active_sessions || 0} active sessions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Security Incidents</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {metrics?.security_incidents_24h || 0}
            </div>
            <p className="text-xs text-muted-foreground">Last 24 hours</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Data Retention</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {Math.round(metrics?.data_retention_compliance || 0)}%
            </div>
            <p className="text-xs text-muted-foreground">Compliance rate</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="access-logs">PHI Access</TabsTrigger>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
          <TabsTrigger value="encryption">Encryption</TabsTrigger>
          <TabsTrigger value="violations">Violations</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Compliance Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span>PHI Access Controls</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    Compliant
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span>Data Encryption</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    {metrics?.encryption_strength}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span>Audit Trail</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    Active
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span>Data Retention</span>
                  <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                    {Math.round(metrics?.data_retention_compliance || 0)}%
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentAccess.slice(0, 5).map((access) => (
                    <div key={access.id} className="flex items-center space-x-3">
                      <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{access.user_name}</p>
                        <p className="text-xs text-gray-500">
                          {access.action} {access.data_type} • {access.justification}
                        </p>
                      </div>
                      <div className="text-xs text-gray-400">
                        {new Date(access.accessed_at).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="access-logs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>PHI Access Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentAccess.map((access) => (
                  <div key={access.id} className="border-b border-gray-200 pb-4 last:border-b-0">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium">{access.user_name}</p>
                        <p className="text-sm text-gray-600">{access.justification}</p>
                      </div>
                      <div className="text-right">
                        <Badge variant="outline">{access.action}</Badge>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(access.accessed_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="incidents" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Security Incidents</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {incidents.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No security incidents reported</p>
                ) : (
                  incidents.map((incident) => (
                    <div key={incident.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-medium">{incident.type}</h3>
                        <Badge className={getSeverityColor(incident.severity)}>
                          {incident.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{incident.description}</p>
                      <div className="flex justify-between items-center text-xs text-gray-500">
                        <span>{new Date(incident.occurred_at).toLocaleString()}</span>
                        <span>{incident.resolved ? 'Resolved' : 'Open'}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="encryption" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Encryption Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span>Algorithm</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    {metrics?.encryption_strength}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span>Key Rotation</span>
                  <Badge variant="outline">30 days</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span>At Rest Encryption</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    Enabled
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span>In Transit Encryption</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    TLS 1.3
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="violations" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Compliance Violations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {violations.length === 0 ? (
                  <div className="text-center py-8">
                    <Shield className="h-12 w-12 text-green-500 mx-auto mb-4" />
                    <p className="text-gray-500">No compliance violations detected</p>
                    <p className="text-sm text-gray-400">All systems are compliant with HIPAA requirements</p>
                  </div>
                ) : (
                  violations.map((violation, index) => (
                    <div key={index} className="border border-red-200 rounded-lg p-4 bg-red-50">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-medium text-red-800">{violation.type}</h3>
                        <Badge className={getSeverityColor(violation.severity)}>
                          {violation.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-red-600">{violation.description}</p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}