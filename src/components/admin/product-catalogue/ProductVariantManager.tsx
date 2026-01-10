import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Plus,
  Pencil,
  Trash2,
  Package,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Eye,
  EyeOff
} from 'lucide-react';
import { toast } from 'sonner';
import { ProductVariant, CreateProductVariantRequest, UpdateProductVariantRequest } from '@/types/product-catalogue';

interface ProductVariantManagerProps {
  productId: string;
  productName: string;
  basePrice: number;
  tenantId: string;
  onVariantUpdate?: () => void;
}

interface VariantFormData {
  variant_name: string;
  variant_type: string;
  price_adjustment_cents: number;
  stock_quantity: number;
  sku: string;
  is_active: boolean;
  display_order: number;
  metadata: Record<string, any>;
}

const defaultFormData: VariantFormData = {
  variant_name: '',
  variant_type: '',
  price_adjustment_cents: 0,
  stock_quantity: 0,
  sku: '',
  is_active: true,
  display_order: 0,
  metadata: {}
};

const VARIANT_TYPES = [
  { value: 'size', label: 'Size' },
  { value: 'color', label: 'Color' },
  { value: 'style', label: 'Style' },
  { value: 'material', label: 'Material' },
  { value: 'duration', label: 'Duration' },
  { value: 'capacity', label: 'Capacity' },
  { value: 'custom', label: 'Custom' }
];

export default function ProductVariantManager({ 
  productId, 
  productName, 
  basePrice,
  tenantId,
  onVariantUpdate 
}: ProductVariantManagerProps) {
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [formData, setFormData] = useState<VariantFormData>(defaultFormData);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [includeInactive, setIncludeInactive] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fetch variants
  const fetchVariants = async () => {
    try {
      const response = await fetch(
        `/api/products/${productId}/variants?include_inactive=${includeInactive}`,
        {
          headers: {
            'X-Tenant-ID': tenantId
          }
        }
      );

      if (!response.ok) throw new Error('Failed to fetch variants');
      
      const data = await response.json();
      setVariants(data.variants || []);
    } catch (error) {
      console.error('Error fetching variants:', error);
      toast.error('Failed to load variants');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVariants();
  }, [productId, includeInactive]);

  // Form validation
  const validateForm = (data: VariantFormData): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (!data.variant_name.trim()) {
      errors.variant_name = 'Variant name is required';
    }

    if (!data.variant_type.trim()) {
      errors.variant_type = 'Variant type is required';
    }

    if (data.stock_quantity < 0) {
      errors.stock_quantity = 'Stock quantity cannot be negative';
    }

    return errors;
  };

  // Create variant
  const handleCreateVariant = async () => {
    const errors = validateForm(formData);
    setFormErrors(errors);

    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const request: CreateProductVariantRequest = {
        ...formData,
        variant_name: formData.variant_name.trim(),
        variant_type: formData.variant_type.trim(),
        sku: formData.sku.trim() || undefined
      };

      const response = await fetch(`/api/products/${productId}/variants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId
        },
        body: JSON.stringify(request)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create variant');
      }

      toast.success('Variant created successfully');
      setShowCreateDialog(false);
      setFormData(defaultFormData);
      setFormErrors({});
      fetchVariants();
      onVariantUpdate?.();
    } catch (error) {
      console.error('Error creating variant:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create variant');
    } finally {
      setSubmitting(false);
    }
  };

  // Update variant
  const handleUpdateVariant = async () => {
    if (!editingVariant) return;

    const errors = validateForm(formData);
    setFormErrors(errors);

    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const request: UpdateProductVariantRequest = {
        variant_name: formData.variant_name.trim(),
        variant_type: formData.variant_type.trim(),
        price_adjustment_cents: formData.price_adjustment_cents,
        stock_quantity: formData.stock_quantity,
        sku: formData.sku.trim() || undefined,
        is_active: formData.is_active,
        display_order: formData.display_order,
        metadata: formData.metadata
      };

      const response = await fetch(`/api/products/${productId}/variants/${editingVariant.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId
        },
        body: JSON.stringify(request)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update variant');
      }

      toast.success('Variant updated successfully');
      setShowEditDialog(false);
      setEditingVariant(null);
      setFormData(defaultFormData);
      setFormErrors({});
      fetchVariants();
      onVariantUpdate?.();
    } catch (error) {
      console.error('Error updating variant:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update variant');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete variant
  const handleDeleteVariant = async (variantId: string, variantName: string) => {
    if (!confirm(`Are you sure you want to delete variant "${variantName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/products/${productId}/variants/${variantId}`, {
        method: 'DELETE',
        headers: {
          'X-Tenant-ID': tenantId
        }
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete variant');
      }

      toast.success('Variant deleted successfully');
      fetchVariants();
      onVariantUpdate?.();
    } catch (error) {
      console.error('Error deleting variant:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete variant');
    }
  };

  // Open edit dialog
  const openEditDialog = (variant: ProductVariant) => {
    setEditingVariant(variant);
    setFormData({
      variant_name: variant.variant_name,
      variant_type: variant.variant_type,
      price_adjustment_cents: variant.price_adjustment_cents,
      stock_quantity: variant.stock_quantity,
      sku: variant.sku || '',
      is_active: variant.is_active,
      display_order: variant.display_order,
      metadata: variant.metadata || {}
    });
    setFormErrors({});
    setShowEditDialog(true);
  };

  // Format price
  const formatPrice = (cents: number): string => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  // Get stock status
  const getStockStatus = (variant: ProductVariant) => {
    if (variant.stock_quantity === 0) {
      return { color: 'destructive', label: 'Out of Stock' };
    } else if (variant.stock_quantity <= 5) {
      return { color: 'warning', label: 'Low Stock' };
    } else {
      return { color: 'success', label: 'In Stock' };
    }
  };

  // Variant form component
  const VariantForm = ({ isEdit = false }: { isEdit?: boolean }) => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="variant_name">Variant Name *</Label>
          <Input
            id="variant_name"
            value={formData.variant_name}
            onChange={(e) => setFormData(prev => ({ ...prev, variant_name: e.target.value }))}
            placeholder="e.g. Large, Red, Premium"
            className={formErrors.variant_name ? 'border-destructive' : ''}
          />
          {formErrors.variant_name && (
            <p className="text-sm text-destructive">{formErrors.variant_name}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="variant_type">Variant Type *</Label>
          <Select 
            value={formData.variant_type} 
            onValueChange={(value) => setFormData(prev => ({ ...prev, variant_type: value }))}
          >
            <SelectTrigger className={formErrors.variant_type ? 'border-destructive' : ''}>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {VARIANT_TYPES.map(type => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {formErrors.variant_type && (
            <p className="text-sm text-destructive">{formErrors.variant_type}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="price_adjustment">Price Adjustment (¢)</Label>
          <Input
            id="price_adjustment"
            type="number"
            value={formData.price_adjustment_cents}
            onChange={(e) => setFormData(prev => ({ 
              ...prev, 
              price_adjustment_cents: parseInt(e.target.value) || 0 
            }))}
            placeholder="0"
            className="text-right"
          />
          <p className="text-xs text-muted-foreground">
            Final Price: {formatPrice(basePrice + formData.price_adjustment_cents)}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="stock_quantity">Stock Quantity</Label>
          <Input
            id="stock_quantity"
            type="number"
            min="0"
            value={formData.stock_quantity}
            onChange={(e) => setFormData(prev => ({ 
              ...prev, 
              stock_quantity: parseInt(e.target.value) || 0 
            }))}
            placeholder="0"
            className={formErrors.stock_quantity ? 'border-destructive text-right' : 'text-right'}
          />
          {formErrors.stock_quantity && (
            <p className="text-sm text-destructive">{formErrors.stock_quantity}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="sku">SKU (Optional)</Label>
          <Input
            id="sku"
            value={formData.sku}
            onChange={(e) => setFormData(prev => ({ ...prev, sku: e.target.value }))}
            placeholder="e.g. PROD-L-RED"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="display_order">Display Order</Label>
          <Input
            id="display_order"
            type="number"
            min="0"
            value={formData.display_order}
            onChange={(e) => setFormData(prev => ({ 
              ...prev, 
              display_order: parseInt(e.target.value) || 0 
            }))}
            placeholder="0"
            className="text-right"
          />
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="is_active"
          checked={formData.is_active}
          onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
        />
        <Label htmlFor="is_active">Active</Label>
      </div>
    </div>
  );

  if (loading) {
    return <div className="text-center py-4">Loading variants...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Product Variants</h3>
          <p className="text-sm text-muted-foreground">
            Manage variations for "{productName}"
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center space-x-2">
            <Switch
              checked={includeInactive}
              onCheckedChange={setIncludeInactive}
            />
            <Label>Show Inactive</Label>
          </div>

          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Variant
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create Product Variant</DialogTitle>
                <DialogDescription>
                  Add a new variant for {productName}
                </DialogDescription>
              </DialogHeader>
              <VariantForm />
              <DialogFooter>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setShowCreateDialog(false);
                    setFormData(defaultFormData);
                    setFormErrors({});
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleCreateVariant} disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create Variant'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Variants Summary */}
      {variants.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Package className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-sm font-medium">Total Variants</p>
                  <p className="text-2xl font-bold">{variants.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium">Active Variants</p>
                  <p className="text-2xl font-bold">
                    {variants.filter(v => v.is_active).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="h-5 w-5 text-orange-600" />
                <div>
                  <p className="text-sm font-medium">Low Stock</p>
                  <p className="text-2xl font-bold">
                    {variants.filter(v => v.stock_quantity <= 5 && v.stock_quantity > 0).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <TrendingDown className="h-5 w-5 text-red-600" />
                <div>
                  <p className="text-sm font-medium">Out of Stock</p>
                  <p className="text-2xl font-bold">
                    {variants.filter(v => v.stock_quantity === 0).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Variants Table */}
      {variants.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="text-lg font-medium mb-2">No Variants Found</h4>
            <p className="text-muted-foreground mb-4">
              This product doesn't have any variants yet.
            </p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Variant
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Variant List</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((variant) => {
                  const stockStatus = getStockStatus(variant);
                  const finalPrice = basePrice + variant.price_adjustment_cents;

                  return (
                    <TableRow key={variant.id}>
                      <TableCell className="font-medium">
                        {variant.variant_name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {variant.variant_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {variant.sku || '-'}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">
                            {formatPrice(finalPrice)}
                          </div>
                          {variant.price_adjustment_cents !== 0 && (
                            <div className="text-sm text-muted-foreground">
                              Base: {formatPrice(basePrice)} 
                              {variant.price_adjustment_cents > 0 ? ' + ' : ' - '}
                              {formatPrice(Math.abs(variant.price_adjustment_cents))}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">
                            {variant.stock_quantity}
                          </div>
                          <Badge 
                            variant={
                              stockStatus.color === 'success' ? 'default' :
                              stockStatus.color === 'warning' ? 'secondary' : 'destructive'
                            }
                            className="text-xs"
                          >
                            {stockStatus.label}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {variant.is_active ? (
                            <Badge>
                              <Eye className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <EyeOff className="h-3 w-3 mr-1" />
                              Inactive
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(variant)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteVariant(variant.id, variant.variant_name)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Product Variant</DialogTitle>
            <DialogDescription>
              Update variant details for {editingVariant?.variant_name}
            </DialogDescription>
          </DialogHeader>
          <VariantForm isEdit />
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowEditDialog(false);
                setEditingVariant(null);
                setFormData(defaultFormData);
                setFormErrors({});
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdateVariant} disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}