import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { Database } from '@/lib/database.types';

interface BookingProductItem {
  product_id: string;
  variant_id?: string;
  quantity: number;
  unit_price_cents: number;
  total_price_cents: number;
}

interface CreateProductBookingRequest {
  customer_id: string;
  service_id?: string;
  appointment_date: string;
  appointment_time: string;
  duration_minutes: number;
  products: BookingProductItem[];
  notes?: string;
  payment_method: 'cash' | 'card' | 'transfer';
  total_amount_cents: number;
}

export const POST = createHttpHandler(
  async (ctx) => {
    // Extract tenant from header
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.notFound('Tenant not found');
    }

    // Verify role has booking permissions
    const allowedRoles = ['superadmin', 'owner', 'manager', 'staff'];
    if (!ctx.user!.role || !allowedRoles.includes(ctx.user!.role)) {
      throw ApiErrorFactory.forbidden('Insufficient permissions');
    }

    const body = await ctx.request.json();
    const {
      customer_id,
      service_id,
      appointment_date,
      appointment_time,
      duration_minutes,
      products,
      notes,
      payment_method,
      total_amount_cents
    }: CreateProductBookingRequest = body;

    // Validate required fields
    if (!customer_id || !appointment_date || !appointment_time || !duration_minutes) {
      throw ApiErrorFactory.badRequest('Missing required booking fields');
    }

    if (!products || products.length === 0) {
      throw ApiErrorFactory.badRequest('At least one product must be selected');
    }

    // Verify customer exists
    const { data: customer } = await ctx.supabase
      .from('customers')
      .select('id, name')
      .eq('id', customer_id)
      .eq('tenant_id', tenantId)
      .single();

    if (!customer) {
      throw ApiErrorFactory.notFound('Customer not found');
    }

    // Validate products and check availability
    for (const productItem of products) {
      const { data: product } = await ctx.supabase
        .from('products')
        .select('id, name, price_cents, track_inventory, is_active')
        .eq('id', productItem.product_id)
        .eq('tenant_id', tenantId)
        .single();

      if (!product || !product.is_active) {
        throw ApiErrorFactory.notFound(`Product not found or inactive: ${productItem.product_id}`);
      }

      // Check variant if specified
      if (productItem.variant_id) {
        const { data: variant } = await ctx.supabase
          .from('product_variants')
          .select('id, name, price_adjustment_cents, is_active')
          .eq('id', productItem.variant_id)
          .eq('product_id', productItem.product_id)
          .eq('tenant_id', tenantId)
          .single();

        if (!variant || !variant.is_active) {
          throw ApiErrorFactory.notFound(`Variant not found or inactive: ${productItem.variant_id}`);
        }
      }

      // Check inventory availability
      if (product.track_inventory) {
        const { data: inventory } = await ctx.supabase
          .from('product_inventory')
          .select('available_stock')
          .eq('product_id', productItem.product_id)
          .eq('variant_id', productItem.variant_id || null)
          .eq('tenant_id', tenantId)
          .single();

        if (inventory && inventory.available_stock < productItem.quantity) {
          const productName = product.name;
          const variantName = productItem.variant_id ? 
            (await ctx.supabase.from('product_variants').select('name').eq('id', productItem.variant_id).single())?.data?.name : 
            '';
          const fullName = variantName ? `${productName} - ${variantName}` : productName;
          
          throw ApiErrorFactory.conflict(
            `Insufficient stock for ${fullName}. Available: ${inventory.available_stock}, Requested: ${productItem.quantity}`
          );
        }
      }
    }

    // Create the booking record
    const appointmentDateTime = new Date(`${appointment_date}T${appointment_time}`);
    
    const { data: booking, error: bookingError } = await ctx.supabase
      .from('product_bookings')
      .insert({
        tenant_id: tenantId,
        customer_id,
        service_id: service_id || null,
        appointment_date,
        appointment_time,
        appointment_datetime: appointmentDateTime.toISOString(),
        duration_minutes,
        total_amount_cents,
        payment_method,
        payment_status: 'pending',
        booking_status: 'confirmed',
        notes: notes || null,
        created_by: ctx.user!.id
      })
      .select()
      .single();

    if (bookingError) {
      console.error('Error creating booking:', bookingError);
      throw ApiErrorFactory.internalServerError('Failed to create booking');
    }

    // Create booking items
    const bookingItems = products.map(product => ({
      tenant_id: tenantId,
      booking_id: booking.id,
      product_id: product.product_id,
      variant_id: product.variant_id || null,
      quantity: product.quantity,
      unit_price_cents: product.unit_price_cents,
      total_price_cents: product.total_price_cents
    }));

    const { error: itemsError } = await ctx.supabase
      .from('product_booking_items')
      .insert(bookingItems);

    if (itemsError) {
      console.error('Error creating booking items:', itemsError);
      
      // Rollback the booking
      await ctx.supabase
        .from('product_bookings')
        .delete()
        .eq('id', booking.id);
      
      throw ApiErrorFactory.internalServerError('Failed to create booking items');
    }

    // Update inventory for products that track inventory
    for (const productItem of products) {
      const { data: product } = await ctx.supabase
        .from('products')
        .select('track_inventory')
        .eq('id', productItem.product_id)
        .single();

      if (product?.track_inventory) {
        // Create inventory movement record
        await ctx.supabase
          .from('inventory_movements')
          .insert({
            tenant_id: tenantId,
            product_id: productItem.product_id,
            variant_id: productItem.variant_id || null,
            movement_type: 'sale',
            quantity_change: -productItem.quantity,
            reference_type: 'booking',
            reference_id: booking.id,
            reason: `Sale from booking ${booking.id}`,
            performed_by: ctx.user!.id
          });

        // Update inventory stock levels
        await ctx.supabase
          .from('product_inventory')
          .update({
            current_stock: ctx.supabase.raw(`current_stock - ${productItem.quantity}`),
            available_stock: ctx.supabase.raw(`available_stock - ${productItem.quantity}`),
            updated_at: new Date().toISOString()
          })
          .eq('product_id', productItem.product_id)
          .eq('variant_id', productItem.variant_id || null)
          .eq('tenant_id', tenantId);
      }
    }

    // Fetch the complete booking with related data
    const { data: completeBooking } = await ctx.supabase
      .from('product_bookings')
      .select(`
        *,
        customer:customers(id, name, email, phone),
        service:services(id, name, duration, price_cents),
        booking_items:product_booking_items(
          *,
          product:products(id, name, images, sku),
          variant:product_variants(id, name, sku)
        )
      `)
      .eq('id', booking.id)
      .single();

    return {
      success: true,
      booking: completeBooking,
      message: 'Booking created successfully'
    };
  },
  'POST',
  { auth: true, roles: ['superadmin', 'owner', 'manager', 'staff'] }
);

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.notFound('Tenant not found');
    }

    const url = new URL(ctx.request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const status = url.searchParams.get('status');
    const customer_id = url.searchParams.get('customer_id');
    const date_from = url.searchParams.get('date_from');
    const date_to = url.searchParams.get('date_to');
    const payment_status = url.searchParams.get('payment_status');

    const offset = (page - 1) * limit;

    // Build query
    let query = ctx.supabase
      .from('product_bookings')
      .select(`
        *,
        customer:customers(id, name, email, phone),
        service:services(id, name, duration, price_cents),
        booking_items:product_booking_items(
          *,
          product:products(id, name, images, sku),
          variant:product_variants(id, name, sku)
        )
      `, { count: 'exact' })
      .eq('tenant_id', tenantId);

    // Apply filters
    if (status) {
      query = query.eq('booking_status', status);
    }

    if (payment_status) {
      query = query.eq('payment_status', payment_status);
    }

    if (customer_id) {
      query = query.eq('customer_id', customer_id);
    }

    if (date_from) {
      query = query.gte('appointment_date', date_from);
    }

    if (date_to) {
      query = query.lte('appointment_date', date_to);
    }

    // Apply pagination and ordering
    query = query
      .order('appointment_datetime', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: bookings, error, count } = await query;

    if (error) {
      console.error('Error fetching product bookings:', error);
      throw ApiErrorFactory.internalServerError('Failed to fetch bookings');
    }

    return {
      bookings: bookings || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    };
  },
  'GET',
  { auth: true }
);