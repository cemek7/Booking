'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { Product, ProductVariant } from '@/types/product-catalogue';
import ProductSelector from '@/components/booking/ProductSelector';
import BookingProductList from '@/components/booking/BookingProductList';
import Button from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { authPost } from '@/lib/auth/auth-api-client';

interface SelectedProduct {
  product: Product;
  variant?: ProductVariant;
  quantity: number;
  price: number;
}

interface IntegratedBookingFormProps {
  customerId?: string;
  serviceId?: string;
  onBookingCreated?: (bookingId: string) => void;
  initialProducts?: SelectedProduct[];
}

export default function IntegratedBookingForm({
  customerId,
  serviceId,
  onBookingCreated,
  initialProducts = []
}: IntegratedBookingFormProps) {
  const { tenant } = useTenant();
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>(initialProducts);
  const [bookingDetails, setBookingDetails] = useState({
    appointment_date: '',
    appointment_time: '',
    duration_minutes: 60,
    notes: '',
    payment_method: 'cash' as 'cash' | 'card' | 'transfer'
  });
  const [productsTotal, setProductsTotal] = useState(0);
  const [showProductSelector, setShowProductSelector] = useState(false);

  // Create booking mutation
  const createBookingMutation = useMutation({
    mutationFn: async (bookingData: any) => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const response = await authPost('/api/bookings/products', bookingData);
      
      if (response.error) {
        throw new Error(response.error || 'Failed to create booking');
      }

      return response.data;
    },
    onSuccess: (data) => {
      toast.success('Booking created successfully');
      if (onBookingCreated) {
        onBookingCreated(data.booking.id);
      }
      // Reset form
      setSelectedProducts([]);
      setBookingDetails({
        appointment_date: '',
        appointment_time: '',
        duration_minutes: 60,
        notes: '',
        payment_method: 'cash'
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create booking');
    },
  });

  const handleProductSelect = (product: Product, variant?: ProductVariant, quantity: number = 1) => {
    const basePrice = product.price_cents;
    const adjustment = variant?.price_adjustment_cents || 0;
    const finalPrice = (basePrice + adjustment) / 100;

    const newProduct: SelectedProduct = {
      product,
      variant,
      quantity,
      price: finalPrice
    };

    setSelectedProducts(prev => [...prev, newProduct]);
    setShowProductSelector(false);
  };

  const handleUpdateQuantity = (index: number, quantity: number) => {
    setSelectedProducts(prev => 
      prev.map((item, i) => 
        i === index ? { ...item, quantity } : item
      )
    );
  };

  const handleRemoveProduct = (index: number) => {
    setSelectedProducts(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!customerId) {
      toast.error('Customer must be selected');
      return;
    }

    if (selectedProducts.length === 0) {
      toast.error('At least one product must be selected');
      return;
    }

    if (!bookingDetails.appointment_date || !bookingDetails.appointment_time) {
      toast.error('Appointment date and time are required');
      return;
    }

    const bookingData = {
      customer_id: customerId,
      service_id: serviceId,
      appointment_date: bookingDetails.appointment_date,
      appointment_time: bookingDetails.appointment_time,
      duration_minutes: bookingDetails.duration_minutes,
      notes: bookingDetails.notes,
      payment_method: bookingDetails.payment_method,
      products: selectedProducts.map(item => ({
        product_id: item.product.id,
        variant_id: item.variant?.id,
        quantity: item.quantity,
        unit_price_cents: Math.round(item.price * 100),
        total_price_cents: Math.round(item.price * item.quantity * 100)
      })),
      total_amount_cents: Math.round(productsTotal * 100)
    };

    createBookingMutation.mutate(bookingData);
  };

  const canSubmit = customerId && 
    selectedProducts.length > 0 && 
    bookingDetails.appointment_date && 
    bookingDetails.appointment_time &&
    !createBookingMutation.isLoading;

  return (
    <div className="space-y-6">
      {/* Booking Details Form */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-medium mb-4">Booking Details</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Appointment Date *
            </label>
            <input
              type="date"
              value={bookingDetails.appointment_date}
              onChange={(e) => setBookingDetails(prev => ({
                ...prev,
                appointment_date: e.target.value
              }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Appointment Time *
            </label>
            <input
              type="time"
              value={bookingDetails.appointment_time}
              onChange={(e) => setBookingDetails(prev => ({
                ...prev,
                appointment_time: e.target.value
              }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Duration (minutes)
            </label>
            <input
              type="number"
              min="15"
              max="480"
              step="15"
              value={bookingDetails.duration_minutes}
              onChange={(e) => setBookingDetails(prev => ({
                ...prev,
                duration_minutes: parseInt(e.target.value) || 60
              }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Method
            </label>
            <select
              value={bookingDetails.payment_method}
              onChange={(e) => setBookingDetails(prev => ({
                ...prev,
                payment_method: e.target.value as any
              }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="transfer">Bank Transfer</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea
            value={bookingDetails.notes}
            onChange={(e) => setBookingDetails(prev => ({
              ...prev,
              notes: e.target.value
            }))}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Any special instructions or notes..."
          />
        </div>
      </div>

      {/* Selected Products */}
      <BookingProductList
        selectedProducts={selectedProducts}
        onUpdateQuantity={handleUpdateQuantity}
        onRemoveProduct={handleRemoveProduct}
        onUpdateTotal={setProductsTotal}
        showPricing={true}
        editable={true}
      />

      {/* Add Products Button */}
      <div className="text-center">
        <Button
          onClick={() => setShowProductSelector(!showProductSelector)}
          variant="outline"
          className="mb-4"
        >
          {showProductSelector ? 'Hide Product Selector' : 'Add Products'}
        </Button>
      </div>

      {/* Product Selector */}
      {showProductSelector && (
        <ProductSelector
          onProductSelect={handleProductSelect}
          selectedProducts={selectedProducts}
          multiSelect={true}
          showPricing={true}
        />
      )}

      {/* Total and Submit */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <div className="text-sm text-gray-600">Total Amount</div>
            <div className="text-2xl font-bold">${productsTotal.toFixed(2)}</div>
            <div className="text-sm text-gray-500">
              {selectedProducts.reduce((sum, item) => sum + item.quantity, 0)} total items
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-primary text-white px-8 py-3 text-lg"
          >
            {createBookingMutation.isLoading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                Creating Booking...
              </>
            ) : (
              'Create Booking'
            )}
          </Button>
        </div>

        {!customerId && (
          <div className="text-sm text-red-600 mb-2">
            Please select a customer to proceed
          </div>
        )}

        {selectedProducts.length === 0 && (
          <div className="text-sm text-red-600 mb-2">
            Please add at least one product to proceed
          </div>
        )}
      </div>
    </div>
  );
}