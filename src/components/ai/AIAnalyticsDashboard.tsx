import React, { useState, useEffect } from 'react';
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
  Robot,
  Lightbulb,
  ChevronDown,
  Filter
} from 'lucide-react';

import { SmartBookingRecommendations, CustomerProfile, ServiceRecommendation } from '@/lib/ai/smartBookingRecommendations';
import { AdvancedConversationAI, ConversationContext, EmotionalState } from '@/lib/ai/advancedConversationAI';
import { PredictiveAnalyticsEngine, RevenueMetrics, CustomerAnalytics, TenantBenchmark } from '@/lib/ai/predictiveAnalytics';
import { AutomationWorkflows, AutomationRule, ContentGeneration } from '@/lib/ai/automationWorkflows';

interface AIAnalyticsProps {
  tenantId: string;
  timeframe?: 'daily' | 'weekly' | 'monthly' | 'quarterly';
}

const AIAnalyticsDashboard: React.FC<AIAnalyticsProps> = ({ tenantId, timeframe = 'monthly' }) => {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [timeRange, setTimeRange] = useState(timeframe);
  
  // AI Engines
  const [smartRecommendations] = useState(new SmartBookingRecommendations());
  const [conversationAI] = useState(new AdvancedConversationAI());
  const [predictiveEngine] = useState(new PredictiveAnalyticsEngine());
  const [automationWorkflows] = useState(new AutomationWorkflows());
  
  // Data states
  const [revenueMetrics, setRevenueMetrics] = useState<RevenueMetrics | null>(null);
  const [customerAnalytics, setCustomerAnalytics] = useState<CustomerAnalytics[]>([]);
  const [tenantBenchmark, setTenantBenchmark] = useState<TenantBenchmark | null>(null);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [aiInsights, setAiInsights] = useState<any[]>([]);
  const [conversationMetrics, setConversationMetrics] = useState<any>({});
  const [contentPerformance, setContentPerformance] = useState<any[]>([]);

  useEffect(() => {
    loadAIAnalytics();
  }, [tenantId, timeRange]);

  const loadAIAnalytics = async () => {
    setLoading(true);
    try {
      // Load all AI analytics data in parallel
      const [
        revenue,
        customers,
        benchmark,
        insights,
        conversation,
        content
      ] = await Promise.all([
        predictiveEngine.generateRevenueForecast(tenantId, 'monthly'),
        predictiveEngine.analyzeCustomerLifetimeValue(tenantId),
        predictiveEngine.generatePerformanceBenchmarks(tenantId),
        predictiveEngine.generatePredictiveInsights(tenantId),
        loadConversationMetrics(),
        loadContentPerformance()
      ]);

      setRevenueMetrics(revenue);
      setCustomerAnalytics(Array.isArray(customers) ? customers : [customers]);
      setTenantBenchmark(benchmark);
      setAiInsights(insights);
      setConversationMetrics(conversation);
      setContentPerformance(content);

    } catch (error) {
      console.error('Error loading AI analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadConversationMetrics = async () => {
    // Mock conversation metrics
    return {
      total_conversations: 245,
      avg_response_time: 1.2,
      customer_satisfaction: 4.7,
      escalation_rate: 0.05,
      emotion_distribution: [
        { emotion: 'satisfied', count: 120, percentage: 49 },
        { emotion: 'happy', count: 85, percentage: 35 },
        { emotion: 'confused', count: 25, percentage: 10 },
        { emotion: 'frustrated', count: 15, percentage: 6 }
      ]
    };
  };

  const loadContentPerformance = async () => {
    // Mock content performance data
    return [
      { type: 'reminder', sent: 1200, opened: 1080, clicked: 324, converted: 162 },
      { type: 'offer', sent: 450, opened: 360, clicked: 162, converted: 81 },
      { type: 'follow_up', sent: 320, opened: 256, clicked: 96, converted: 38 }
    ];
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
          <Select value={timeRange} onValueChange={setTimeRange}>
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
                    : '85%'
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
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Low Risk', value: 60, color: '#10b981' },
                          { name: 'Medium Risk', value: 25, color: '#f59e0b' },
                          { name: 'High Risk', value: 15, color: '#ef4444' }
                        ]}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        dataKey="value"
                      >
                        {[
                          { name: 'Low Risk', value: 60, color: '#10b981' },
                          { name: 'Medium Risk', value: 25, color: '#f59e0b' },
                          { name: 'High Risk', value: 15, color: '#ef4444' }
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={[
                  { segment: 'VIP', count: 12, avg_clv: 2500 },
                  { segment: 'High Value', count: 28, avg_clv: 1200 },
                  { segment: 'Regular', count: 156, avg_clv: 450 },
                  { segment: 'New', count: 89, avg_clv: 150 }
                ]}>
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
                <div className="text-2xl font-bold">{conversationMetrics.avg_response_time || 0}s</div>
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
              <CardTitle>Automated Content Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={contentPerformance}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="sent" fill="#e5e7eb" name="Sent" />
                  <Bar dataKey="opened" fill="#8b5cf6" name="Opened" />
                  <Bar dataKey="clicked" fill="#06b6d4" name="Clicked" />
                  <Bar dataKey="converted" fill="#10b981" name="Converted" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Automation Rules Status */}
          <Card>
            <CardHeader>
              <CardTitle>Active Automation Rules</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { name: '24-Hour Reminder', status: 'active', success_rate: 0.89, executions: 145 },
                  { name: 'Follow-up Sequence', status: 'active', success_rate: 0.67, executions: 89 },
                  { name: 'Rebooking Automation', status: 'active', success_rate: 0.34, executions: 23 },
                  { name: 'Feedback Collection', status: 'paused', success_rate: 0.45, executions: 0 }
                ].map((rule, index) => (
                  <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{rule.name}</span>
                        <Badge variant={rule.status === 'active' ? 'default' : 'secondary'}>
                          {rule.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-600">
                        {rule.executions} executions this month
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{formatPercentage(rule.success_rate)}</div>
                      <div className="text-xs text-gray-600">Success rate</div>
                    </div>
                  </div>
                ))}
              </div>
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
              <CardTitle>Cross-Vertical Learning</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 border rounded-lg bg-blue-50">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium">Weekend Booking Patterns</h4>
                    <Badge className="bg-blue-100 text-blue-800">Beauty → Hospitality</Badge>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">
                    Beauty businesses show 40% higher weekend demand. This insight can be applied to hospitality.
                  </p>
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline">Implementation: Easy</Badge>
                    <Badge className="bg-green-100 text-green-800">80% Success Rate</Badge>
                  </div>
                </div>

                <div className="p-4 border rounded-lg bg-purple-50">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium">Reminder Timing Optimization</h4>
                    <Badge className="bg-purple-100 text-purple-800">Medicine → All</Badge>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">
                    Medical practices achieve 25% better response rates with 2-hour advance reminders.
                  </p>
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline">Implementation: Medium</Badge>
                    <Badge className="bg-green-100 text-green-800">65% Success Rate</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AIAnalyticsDashboard;