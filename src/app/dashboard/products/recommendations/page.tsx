'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { Product } from '@/types/product-catalogue';
import { getUserRole } from '@/lib/supabase/auth';
import Button from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

export default function RecommendationsPage() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [selectedContext, setSelectedContext] = useState<'booking' | 'product_view' | 'general'>('general');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [maxRecommendations, setMaxRecommendations] = useState(10);
  const [testCustomerId, setTestCustomerId] = useState('');

  // Fetch user role for permissions
  const { data: userRole } = useQuery({
    queryKey: ['userRole'],
    queryFn: getUserRole,
  });

  // Fetch products for selection
  const { data: productsData } = useQuery({
    queryKey: ['products-for-recommendations', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch('/api/products?limit=100&status=active', {
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch products');
      return res.json();
    },
    enabled: !!tenant?.id,
  });

  // Generate test recommendations
  const { data: recommendationsData, isLoading: recommendationsLoading, refetch: generateRecommendations } = useQuery({
    queryKey: ['test-recommendations', tenant?.id, selectedContext, selectedProductIds, testCustomerId],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const requestBody: any = {
        context: selectedContext,
        max_recommendations: maxRecommendations,
      };

      if (selectedProductIds.length > 0) {
        requestBody.product_ids = selectedProductIds;
      }

      if (testCustomerId) {
        requestBody.customer_id = testCustomerId;
      }

      const res = await fetch('/api/products/recommendations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenant.id,
        },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) throw new Error('Failed to generate recommendations');
      return res.json();
    },
    enabled: false, // Manual trigger only
  });

  // Update upsell priorities mutation
  const updateUpsellMutation = useMutation({
    mutationFn: async ({ productId, priority }: { productId: string; priority: number }) => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenant.id,
        },
        body: JSON.stringify({ upsell_priority: priority }),
      });

      if (!res.ok) throw new Error('Failed to update upsell priority');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Upsell priority updated');
      queryClient.invalidateQueries({ queryKey: ['products-for-recommendations'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update upsell priority');
    },
  });

  const products = productsData?.products || [];
  const recommendations = recommendationsData?.recommendations || [];
  const canManage = userRole && ['superadmin', 'owner', 'manager'].includes(userRole);

  const handleProductSelection = (productId: string, isSelected: boolean) => {
    if (isSelected) {
      setSelectedProductIds(prev => [...prev, productId]);
    } else {
      setSelectedProductIds(prev => prev.filter(id => id !== productId));
    }
  };

  const handleGenerateRecommendations = () => {
    generateRecommendations();
  };

  const handleUpdateUpsellPriority = (productId: string, priority: number) => {
    updateUpsellMutation.mutate({ productId, priority });
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    if (score >= 40) return 'text-orange-600';
    return 'text-red-600';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">AI Recommendations</h1>
          <p className="text-gray-600 mt-1">Manage and test AI-powered product recommendations</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Test Parameters */}
          <div className="xl:col-span-1">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-medium mb-4">Test Recommendations</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Context</label>
                  <select
                    value={selectedContext}
                    onChange={(e) => setSelectedContext(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="general">General Browsing</option>
                    <option value="booking">During Booking</option>
                    <option value="product_view">Product Page View</option>
                    <option value="cart">In Shopping Cart</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Recommendations
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={maxRecommendations}
                    onChange={(e) => setMaxRecommendations(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Test Customer ID (Optional)
                  </label>
                  <input
                    type="text"
                    value={testCustomerId}
                    onChange={(e) => setTestCustomerId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Leave empty for anonymous"
                  />
                </div>

                {(selectedContext === 'product_view' || selectedContext === 'cart') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Products for Context
                    </label>
                    <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md">
                      {products.slice(0, 20).map((product: Product) => (
                        <label key={product.id} className="flex items-center p-2 hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={selectedProductIds.includes(product.id)}
                            onChange={(e) => handleProductSelection(product.id, e.target.checked)}
                            className="mr-2"
                          />
                          <span className="text-sm">{product.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleGenerateRecommendations}
                  disabled={recommendationsLoading}
                  className="w-full bg-primary text-white"
                >
                  {recommendationsLoading ? 'Generating...' : 'Generate Recommendations'}
                </Button>
              </div>
            </div>

            {/* Algorithm Info */}
            <div className="bg-white rounded-lg shadow-sm p-6 mt-6">
              <h3 className="text-lg font-medium mb-4">Algorithm Factors</h3>
              <div className="space-y-2 text-sm text-gray-600">
                <div>• Upsell priority (0-100 points)</div>
                <div>• Featured products (+20 points)</div>
                <div>• Stock availability (+10 points)</div>
                <div>• Service compatibility (+30 points)</div>
                <div>• Purchase history patterns (+25 points)</div>
                <div>• Category similarity (+15 points)</div>
                <div>• Tag matching (+8 points per tag)</div>
                <div>• Customer preferences (collaborative filtering)</div>
              </div>
            </div>
          </div>

          {/* Results & Management */}
          <div className="xl:col-span-2 space-y-6">
            {/* Test Results */}
            {recommendations.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-medium">Test Results</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Generated {recommendations.length} recommendations for {selectedContext} context
                  </p>
                </div>
                
                <Table>
                  <THead>
                    <TR>
                      <TH>Product</TH>
                      <TH>Score</TH>
                      <TH>Confidence</TH>
                      <TH>Reasons</TH>
                      <TH>Price</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {recommendations.map((rec: any, index: number) => (
                      <TR key={rec.product_id}>
                        <TD>
                          <div>
                            <div className="font-medium">{rec.product.name}</div>
                            <div className="text-sm text-gray-500">Rank #{index + 1}</div>
                          </div>
                        </TD>
                        <TD>
                          <span className={`font-semibold ${getScoreColor(rec.score)}`}>
                            {rec.score.toFixed(1)}
                          </span>
                        </TD>
                        <TD>
                          <div className="flex items-center">
                            <div className={`w-16 bg-gray-200 rounded-full h-2 mr-2`}>
                              <div
                                className="bg-primary h-2 rounded-full"
                                style={{ width: `${rec.confidence * 100}%` }}
                              ></div>
                            </div>
                            <span className="text-sm">{(rec.confidence * 100).toFixed(0)}%</span>
                          </div>
                        </TD>
                        <TD>
                          <div className="text-sm text-gray-600">
                            {rec.reasons.slice(0, 2).map((reason: string, i: number) => (
                              <div key={i}>• {reason}</div>
                            ))}
                            {rec.reasons.length > 2 && (
                              <div className="text-xs text-gray-400">
                                +{rec.reasons.length - 2} more reasons
                              </div>
                            )}
                          </div>
                        </TD>
                        <TD>
                          <span className="font-medium text-green-600">
                            ${(rec.product.price_cents / 100).toFixed(2)}
                          </span>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}

            {/* Upsell Priority Management */}
            {canManage && (
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-medium">Upsell Priority Management</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Adjust upsell priorities to influence recommendation ranking
                  </p>
                </div>
                
                <div className="max-h-96 overflow-y-auto">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Product</TH>
                        <TH>Current Priority</TH>
                        <TH>New Priority</TH>
                        <TH>Action</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {products.slice(0, 20).map((product: Product) => {
                        const [newPriority, setNewPriority] = useState(product.upsell_priority);
                        
                        return (
                          <TR key={product.id}>
                            <TD>
                              <div>
                                <div className="font-medium">{product.name}</div>
                                <div className="text-sm text-gray-500">${(product.price_cents / 100).toFixed(2)}</div>
                              </div>
                            </TD>
                            <TD>
                              <span className={`font-medium ${
                                product.upsell_priority > 50 ? 'text-green-600' : 
                                product.upsell_priority > 0 ? 'text-yellow-600' : 'text-gray-500'
                              }`}>
                                {product.upsell_priority}
                              </span>
                            </TD>
                            <TD>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={newPriority}
                                onChange={(e) => setNewPriority(parseInt(e.target.value) || 0)}
                                className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                            </TD>
                            <TD>
                              {newPriority !== product.upsell_priority && (
                                <Button
                                  size="sm"
                                  onClick={() => handleUpdateUpsellPriority(product.id, newPriority)}
                                  disabled={updateUpsellMutation.isLoading}
                                  className="bg-primary text-white"
                                >
                                  Update
                                </Button>
                              )}
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}