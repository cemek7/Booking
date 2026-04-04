'use client';

import { defaultLogger } from '@/lib/logger';
import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  Calendar,
  MessageSquare,
  Zap,
  Target,
  AlertTriangle,
  CheckCircle,
  Clock,
  BarChart3,
  PieChart as PieChartIcon,
  Activity,
  Sparkles,
  Bot as Robot,
  Lightbulb,
  ChevronDown,
  Filter
} from 'lucide-react';

import type { AutomationRule } from '@/lib/ai/automationWorkflows';
import type { RevenueMetrics, CustomerAnalytics, TenantBenchmark } from '@/lib/ai/predictiveAnalytics';
import { getUnifiedAnalyticsAccess, validateAnalyticsRequest } from '@/lib/unified-analytics-permissions';
import type { Role } from '@/types/roles';

interface AIAnalyticsProps {
  tenantId: string;
  userRole: Role;
  userId?: string;
  timeframe?: 'daily' | 'weekly' | 'monthly' | 'quarterly';
}

const AIAnalyticsDashboard: React.FC<AIAnalyticsProps> = ({ tenantId, userRole, userId, timeframe = 'monthly' }) => {
  // All hooks must be declared unconditionally before any early return
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [timeRange, setTimeRange] = useState(timeframe);

  // Data states
  const [revenueMetrics, setRevenueMetrics] = useState<RevenueMetrics | null>(null);
  const [customerAnalytics, setCustomerAnalytics] = useState<CustomerAnalytics[]>([]);
  const [tenantBenchmark, setTenantBenchmark] = useState<TenantBenchmark | null>(null);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [aiInsights, setAiInsights] = useState<any[]>([]);
  const [conversationMetrics, setConversationMetrics] = useState<any>({});
  const [contentPerformance, setContentPerformance] = useState<any[]>([]);
  const [verticalInsights, setVerticalInsights] = useState<any[]>([]);

  // AI engines run server-side via /api/ai/predictions
  useEffect(() => {
    loadAIAnalytics();
  }, [tenantId, timeRange]);

  // Derived memos — must also be unconditionally above the early return
  const churnDistribution = useMemo(() => {
    if (!customerAnalytics.length) return [];
    const counts: Record<string, number> = { low: 0, medium: 0, high: 0 };
    customerAnalytics.forEach((c) => {
      const level = c.churn_analysis.churn_risk_level;
      if (level === 'critical' || level === 'high') counts.high += 1;
      else if (level === 'medium') counts.medium += 1;
      else counts.low += 1;
    });
    return [
      { name: 'Low Risk', value: counts.low, color: '#10b981' },
      { name: 'Medium Risk', value: counts.medium, color: '#f59e0b' },
      { name: 'High Risk', value: counts.high, color: '#ef4444' },
    ].filter((d) => d.value > 0);
  }, [customerAnalytics]);

  const clvDistribution = useMemo(() => {
    if (!customerAnalytics.length) return [];
    const segments: Record<string, { count: number; total: number }> = {};
    customerAnalytics.forEach((c) => {
      const seg = c.lifetime_value.value_segment;
      if (!segments[seg]) segments[seg] = { count: 0, total: 0 };
      segments[seg].count += 1;
      segments[seg].total += c.lifetime_value.current_clv;
    });
    return Object.entries(segments).map(([segment, data]) => ({
      segment,
      count: data.count,
      avg_clv: data.count > 0 ? Math.round(data.total / data.count) : 0,
    }));
  }, [customerAnalytics]);

  // Permission check after all hooks
  const analyticsAccess = getUnifiedAnalyticsAccess(userRole);
  const tenantValidation = validateAnalyticsRequest(userRole, 'tenant', tenantId, userId);

  if (!analyticsAccess.permissions.canViewTenantData || !tenantValidation.allowed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Analytics Access Restricted</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {tenantValidation.reason || 'You do not have permission to view AI analytics insights.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const loadAIAnalytics = async () => {
    setLoading(true);
    try {
      const [
        predictionsRes,
        conversation,
        content,
        jobsRes,
        beautyRes,
        hospitalityRes,
        medicineRes,
      ] = await Promise.all([
        fetch(`/api/ai/predictions?timeRange=${timeRange}`, { headers: { 'X-Tenant-ID': tenantId } })
          .then((r) => r.ok ? r.json() : {}),
        loadConversationMetrics(),
        loadContentPerformance(),
        fetch('/api/jobs').then((r) => r.ok ? r.json() : { stats: {} }),
        fetch('/api/analytics/vertical?vertical=beauty').then((r) => r.ok ? r.json() : null),
        fetch('/api/analytics/vertical?vertical=hospitality').then((r) => r.ok ? r.json() : null),
        fetch('/api/analytics/vertical?vertical=medicine').then((r) => r.ok ? r.json() : null),
      ]);

      const { revenue, customers, benchmark, insights } = predictionsRes as any;
      setRevenueMetrics(revenue);
      setCustomerAnalytics(Array.isArray(customers) ? customers : [customers]);
      setTenantBenchmark(benchmark);
      setAiInsights(insights);
      setConversationMetrics(conversation);
      setContentPerformance(content);

      // Map job stats to automation-rule-like summary cards
      const stats = jobsRes?.stats ?? {};
      const total = (stats.pending ?? 0) + (stats.processing ?? 0) + (stats.completed ?? 0) + (stats.failed ?? 0);
      const successRate = total > 0 ? (stats.completed ?? 0) / total : 0;
      if (total > 0) {
        setAutomationRules([{
          id: 'job-summary',
          tenant_id: tenantId,
          name: 'Background Jobs (last 24h)',
          description: '',
          trigger: { type: 'time_based', conditions: [] },
          actions: [],
          status: 'active',
          success_rate: successRate,
          last_executed: new Date().toISOString(),
          next_execution: '',
          created_at: '',
        } as AutomationRule]);
      }

      // Build cross-vertical insights from real analytics data
      const insights_list = [beautyRes, hospitalityRes, medicineRes]
        .filter(Boolean)
        .map((v: any) => ({
          vertical: v.vertical,
          analytics: v.analytics,
        }));
      setVerticalInsights(insights_list);

    } catch (error) {
      defaultLogger.error('Error loading AI analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadConversationMetrics = async () => {
    try {
      const [chatsRes, feedbackRes, escalationPendingRes, escalationResolvedRes] = await Promise.all([
        fetch(`/api/chats?tenant_id=${tenantId}`),
        fetch('/api/feedback?days=30'),
        fetch('/api/escalation?status=pending'),
        fetch('/api/escalation?status=resolved'),
      ]);

      const chats = chatsRes.ok ? await chatsRes.json() : [];
      const feedback = feedbackRes.ok ? await feedbackRes.json() : { summary: {}, feedback: [] };
      const pending = escalationPendingRes.ok ? await escalationPendingRes.json() : { escalations: [] };
      const resolved = escalationResolvedRes.ok ? await escalationResolvedRes.json() : { escalations: [] };

      const totalChats = Array.isArray(chats) ? chats.length : 0;
      const totalEscalations = (pending.escalations?.length ?? 0) + (resolved.escalations?.length ?? 0);
      const escalationRate = totalChats > 0 ? totalEscalations / totalChats : 0;

      // Derive emotion distribution from feedback scores
      const feedbackRows: { score: number }[] = feedback.feedback ?? [];
      const scoreBuckets: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      feedbackRows.forEach((f) => { if (f.score >= 1 && f.score <= 5) scoreBuckets[f.score]++; });
      const totalFeedback = feedbackRows.length || 1;
      const emotion_distribution = [
        { emotion: 'happy', count: scoreBuckets[5], percentage: Math.round((scoreBuckets[5] / totalFeedback) * 100) },
        { emotion: 'satisfied', count: scoreBuckets[4], percentage: Math.round((scoreBuckets[4] / totalFeedback) * 100) },
        { emotion: 'neutral', count: scoreBuckets[3], percentage: Math.round((scoreBuckets[3] / totalFeedback) * 100) },
        { emotion: 'confused', count: scoreBuckets[2], percentage: Math.round((scoreBuckets[2] / totalFeedback) * 100) },
        { emotion: 'frustrated', count: scoreBuckets[1], percentage: Math.round((scoreBuckets[1] / totalFeedback) * 100) },
      ].filter((e) => e.count > 0);

      return {
        total_conversations: totalChats,
        customer_satisfaction: feedback.summary?.avg_score ?? null,
        escalation_rate: escalationRate,
        emotion_distribution,
      };
    } catch {
      return {};
    }
  };

  const loadContentPerformance = async () => {
    try {
      const res = await fetch('/api/analytics/notifications?days=30');
      if (!res.ok) return [];
      const data = await res.json();
      return data.content_performance ?? [];
    } catch {
      return [];
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  const getPerformanceIcon = (trend: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'down':
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      default:
        return <Activity className="h-4 w-4 text-gray-500" />;
    }
  };

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case 'low':
        return 'bg-green-100 text-green-800';
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center space-x-2">
          <Brain className="h-6 w-6 animate-pulse text-purple-600" />
          <span className="text-lg">Loading AI Analytics...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Brain className="h-8 w-8 mr-3 text-purple-600" />
            AI Analytics Dashboard
          </h1>
          <p className="text-gray-600">Intelligent insights and automation performance</p>
        </div>
        <div className="flex items-center space-x-4">
          <Select value={timeRange} onValueChange={(v) => setTimeRange(v as typeof timeRange)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={loadAIAnalytics} variant="outline">
            <Activity className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="revenue">Revenue AI</TabsTrigger>
          <TabsTrigger value="customers">Customer AI</TabsTrigger>
          <TabsTrigger value="conversations">Conversation AI</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Key Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">AI Revenue Impact</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {revenueMetrics ? formatCurrency(revenueMetrics.current_period.revenue) : '$0'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {revenueMetrics ? `+${revenueMetrics.forecast.growth_rate.toFixed(1)}% from AI optimization` : 'Loading...'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Customer Satisfaction</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {conversationMetrics.customer_satisfaction?.toFixed(1) || '0'}/5
                </div>
                <p className="text-xs text-muted-foreground">
                  Via AI conversation analysis
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Automation Success</CardTitle>
                <Robot className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {automationRules.length > 0
                    ? `${(automationRules.reduce((sum, rule) => sum + rule.success_rate, 0) / automationRules.length * 100).toFixed(0)}%`
                    : '—'
                  }
                </div>
                <p className="text-xs text-muted-foreground">
                  Average workflow success rate
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">AI Insights Generated</CardTitle>
                <Lightbulb className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{aiInsights.length}</div>
                <p className="text-xs text-muted-foreground">
                  Actionable business insights
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Performance Benchmark */}
          {tenantBenchmark && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Target className="h-5 w-5 mr-2" />
                  Industry Performance Comparison
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Overall Percentile</span>
                    <div className="flex items-center space-x-2">
                      <Badge variant="secondary" className="bg-purple-100 text-purple-800">
                        {tenantBenchmark.industry_comparison.percentile_rank}th percentile
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <div className="text-sm text-gray-600">Revenue</div>
                      <Badge className={
                        tenantBenchmark.industry_comparison.performance_vs_industry.revenue === 'above' 
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }>
                        {tenantBenchmark.industry_comparison.performance_vs_industry.revenue}
                      </Badge>
                    </div>
                    <div className="text-center">
                      <div className="text-sm text-gray-600">Efficiency</div>
                      <Badge className={
                        tenantBenchmark.industry_comparison.performance_vs_industry.efficiency === 'above' 
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }>
                        {tenantBenchmark.industry_comparison.performance_vs_industry.efficiency}
                      </Badge>
                    </div>
                    <div className="text-center">
                      <div className="text-sm text-gray-600">Satisfaction</div>
                      <Badge className={
                        tenantBenchmark.industry_comparison.performance_vs_industry.customer_satisfaction === 'above' 
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }>
                        {tenantBenchmark.industry_comparison.performance_vs_industry.customer_satisfaction}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent AI Insights */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Sparkles className="h-5 w-5 mr-2" />
                Latest AI Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64">
                <div className="space-y-3">
                  {aiInsights.slice(0, 5).map((insight, index) => (
                    <div key={index} className="p-3 border rounded-lg">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <Badge variant="outline">{insight.type?.replace('_', ' ')}</Badge>
                            <Badge className={getRiskLevelColor(insight.prediction?.impact_magnitude)}>
                              {insight.prediction?.impact_magnitude} impact
                            </Badge>
                          </div>
                          <p className="text-sm font-medium">{insight.prediction?.outcome}</p>
                          <p className="text-xs text-gray-600">
                            Confidence: {formatPercentage(insight.prediction?.confidence || 0)}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-500">{insight.prediction?.time_horizon}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Revenue AI Tab */}
        <TabsContent value="revenue" className="space-y-6">
          {revenueMetrics && (
            <>
              {/* Revenue Forecast */}
              <Card>
                <CardHeader>
                  <CardTitle>Revenue Forecast</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm text-gray-600">Next Month</div>
                          <div className="text-2xl font-bold">
                            {formatCurrency(revenueMetrics.forecast.next_month)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">Growth Rate</div>
                          <div className="text-2xl font-bold text-green-600">
                            +{revenueMetrics.forecast.growth_rate.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <div className="text-sm text-gray-600 mb-2">Confidence Interval</div>
                        <div className="space-y-1">
                          <div className="text-sm">
                            Low: {formatCurrency(revenueMetrics.forecast.confidence_interval.low)}
                          </div>
                          <div className="text-sm">
                            High: {formatCurrency(revenueMetrics.forecast.confidence_interval.high)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={revenueMetrics.trends.daily_revenue.slice(-14)}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis />
                          <Tooltip formatter={(value) => formatCurrency(value as number)} />
                          <Line type="monotone" dataKey="amount" stroke="#8b5cf6" strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Service Performance */}
              <Card>
                <CardHeader>
                  <CardTitle>Service Performance Analytics</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {revenueMetrics.trends.service_performance.map((service, index) => (
                      <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                          <span className="font-medium">{service.service}</span>
                          {getPerformanceIcon(service.trend)}
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{formatCurrency(service.revenue)}</div>
                          <Badge variant={service.trend === 'up' ? 'default' : 'secondary'}>
                            {service.trend}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Customer AI Tab */}
        <TabsContent value="customers" className="space-y-6">
          {/* Churn Risk Analysis */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2" />
                Customer Churn Risk Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  {churnDistribution.length === 0 ? (
                    <div className="h-[200px] flex items-center justify-center text-sm text-gray-400">
                      No customer data available
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={churnDistribution}
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          dataKey="value"
                        >
                          {churnDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">High-Risk Customers</h4>
                    <div className="space-y-2">
                      {customerAnalytics.filter(c => c.churn_analysis.churn_risk_level === 'high').slice(0, 3).map((customer, index) => (
                        <div key={index} className="flex items-center justify-between p-2 border rounded">
                          <span className="text-sm">Customer {customer.customer_id.slice(-4)}</span>
                          <Badge className="bg-red-100 text-red-800">
                            {formatPercentage(customer.churn_analysis.churn_probability)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Customer Lifetime Value */}
          <Card>
            <CardHeader>
              <CardTitle>Customer Lifetime Value Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {clvDistribution.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-sm text-gray-400">
                  No customer data available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={clvDistribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="segment" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="count" fill="#8b5cf6" name="Customer Count" />
                    <Bar yAxisId="right" dataKey="avg_clv" fill="#06b6d4" name="Avg CLV" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Conversation AI Tab */}
        <TabsContent value="conversations" className="space-y-6">
          {/* Conversation Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Conversations</CardTitle>
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{conversationMetrics.total_conversations || 0}</div>
                <p className="text-xs text-muted-foreground">This month</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {conversationMetrics.avg_response_time != null ? `${conversationMetrics.avg_response_time}s` : '—'}
                </div>
                <p className="text-xs text-muted-foreground">AI-powered responses</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Escalation Rate</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatPercentage(conversationMetrics.escalation_rate || 0)}
                </div>
                <p className="text-xs text-muted-foreground">To human agents</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Satisfaction Score</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {conversationMetrics.customer_satisfaction?.toFixed(1) || 0}/5
                </div>
                <p className="text-xs text-muted-foreground">Customer feedback</p>
              </CardContent>
            </Card>
          </div>

          {/* Emotional Intelligence */}
          <Card>
            <CardHeader>
              <CardTitle>Customer Emotional Intelligence</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium mb-4">Emotion Distribution</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={conversationMetrics.emotion_distribution || []}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        dataKey="count"
                        nameKey="emotion"
                      >
                        {(conversationMetrics.emotion_distribution || []).map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={['#10b981', '#8b5cf6', '#f59e0b', '#ef4444'][index]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div>
                  <h4 className="font-medium mb-4">Emotional Trends</h4>
                  <div className="space-y-3">
                    {(conversationMetrics.emotion_distribution || []).map((emotion: any, index: number) => (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm capitalize">{emotion.emotion}</span>
                          <span className="text-sm font-medium">{emotion.percentage}%</span>
                        </div>
                        <Progress value={emotion.percentage} className="h-2" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Automation Tab */}
        <TabsContent value="automation" className="space-y-6">
          {/* Content Performance */}
          <Card>
            <CardHeader>
              <CardTitle>Notification Performance</CardTitle>
            </CardHeader>
            <CardContent>
              {contentPerformance.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No notification data for the last 30 days.</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={contentPerformance}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="type" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="sent" fill="#e5e7eb" name="Scheduled" />
                    <Bar dataKey="executed" fill="#10b981" name="Executed" />
                    <Bar dataKey="pending" fill="#8b5cf6" name="Pending" />
                    <Bar dataKey="cancelled" fill="#ef4444" name="Cancelled" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Automation Rules Status */}
          <Card>
            <CardHeader>
              <CardTitle>Active Automation Rules</CardTitle>
            </CardHeader>
            <CardContent>
              {automationRules.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  No automation rules configured.
                </p>
              ) : (
                <div className="space-y-4">
                  {automationRules.map((rule, index) => (
                    <div key={rule.id || index} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-medium">{rule.name}</span>
                          <Badge variant={rule.status === 'active' ? 'default' : 'secondary'}>
                            {rule.status}
                          </Badge>
                        </div>
                        <div className="text-sm text-gray-600">
                          Last run: {rule.last_executed ? new Date(rule.last_executed).toLocaleDateString() : 'Never'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{formatPercentage(rule.success_rate)}</div>
                        <div className="text-xs text-gray-600">Success rate</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Insights Tab */}
        <TabsContent value="insights" className="space-y-6">
          {/* AI Recommendations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Lightbulb className="h-5 w-5 mr-2" />
                AI-Generated Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {aiInsights.map((insight, index) => (
                  <div key={index} className="p-4 border rounded-lg">
                    <div className="flex items-start justify-between mb-3">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <Badge variant="outline" className="capitalize">
                            {insight.type?.replace('_', ' ')}
                          </Badge>
                          <Badge className={getRiskLevelColor(insight.prediction?.impact_magnitude)}>
                            {insight.prediction?.impact_magnitude} impact
                          </Badge>
                        </div>
                        <h4 className="font-medium">{insight.prediction?.outcome}</h4>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">
                          {formatPercentage(insight.prediction?.confidence || 0)} confidence
                        </div>
                        <div className="text-xs text-gray-500">
                          {insight.prediction?.time_horizon}
                        </div>
                      </div>
                    </div>

                    {insight.recommendations?.length > 0 && (
                      <div className="space-y-2">
                        <h5 className="text-sm font-medium">Recommended Actions:</h5>
                        {insight.recommendations.slice(0, 2).map((rec: any, recIndex: number) => (
                          <div key={recIndex} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                            <span className="text-sm">{rec.action}</span>
                            <div className="flex items-center space-x-2">
                              <Badge variant="outline" className={getRiskLevelColor(rec.priority)}>
                                {rec.priority}
                              </Badge>
                              <span className="text-xs text-gray-600">{rec.timeline}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Cross-Vertical Insights */}
          <Card>
            <CardHeader>
              <CardTitle>Cross-Vertical Analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {verticalInsights.map((v) => (
                  <div key={v.vertical} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium capitalize">{v.vertical}</h4>
                    </div>
                    {v.analytics?.metrics?.conversion_funnels?.length > 0 ? (
                      <div className="space-y-2">
                        {v.analytics.metrics.conversion_funnels.map((step: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="text-gray-600 capitalize">{step.step}</span>
                            <div className="flex items-center space-x-2">
                              <span className="text-gray-800 font-medium">{step.count}</span>
                              <Badge variant="outline">{(step.conversion_rate * 100).toFixed(1)}%</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">No funnel data yet for this vertical.</p>
                    )}
                  </div>
                ))}
                {verticalInsights.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">Loading vertical analytics…</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AIAnalyticsDashboard;
