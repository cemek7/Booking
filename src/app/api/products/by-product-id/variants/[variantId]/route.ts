import { NextRequest, NextResponse } from 'next/server';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { Database } from '@/lib/database.types';
import { getTenantFromHeaders } from '@/lib/supabase/tenant-context';
import { getUserRoleFromRequest } from '@/lib/auth/server-role-check';
import { CreateVariantRequest } from '@/types/product-catalogue';

interface RouteParams {
  params: { 
    productId: string;
    variantId: string;
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string; variantId: string } }
) {
  try {
    const { productId, variantId } = params;
    const supabase = createServerComponentClient<Database>({ cookies });
    const tenant = await getTenantFromHeaders(request);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Get specific variant
    const { data: variant, error } = await supabase
      .from('product_variants')
      .select(`
        *,
        product_inventory (
          current_stock,
          reserved_stock,
          available_stock
        )
      `)
      .eq('id', variantId)
      .eq('product_id', productId)
      .eq('tenant_id', tenant.id)
      .single();

    if (error || !variant) {
      return NextResponse.json(
        { error: 'Variant not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ variant });

  } catch (error) {
    console.error('Error fetching variant:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user role and permissions
    const userRole = await getUserRole(user.id);
    const permissions = PRODUCT_ROLE_PERMISSIONS[userRole];
    
    if (!permissions.can_view_products) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Get user's tenant(s)
    const { data: tenantUsers } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', user.id);

    if (!tenantUsers || tenantUsers.length === 0) {
      return NextResponse.json({ error: 'No tenant access' }, { status: 403 });
    }

    const tenantIds = tenantUsers.map(tu => tu.tenant_id);

    // Fetch variant with product information
    const { data: variant, error } = await supabase
      .from('product_variants')
      .select(`
        *,
        product:products!product_id(
          id, name, price_cents, currency, tenant_id,
          category:product_categories!category_id(id, name)
        )
      `)
      .eq('id', params.variantId)
      .eq('product_id', params.productId)
      .in('tenant_id', tenantIds)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
      }
      console.error('Product variant fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch variant' }, { status: 500 });
    }

    // Calculate final price
    const variantWithPrice = {
      ...variant,
      final_price_cents: variant.product.price_cents + variant.price_adjustment_cents,
    };

    return NextResponse.json({ variant: variantWithPrice });

  } catch (error) {
    console.error('Product variant fetch API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { productId: string; variantId: string } }
) {
  try {
    const { productId, variantId } = params;
    const supabase = createServerComponentClient<Database>({ cookies });
    const tenant = await getTenantFromHeaders(request);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Check user permissions
    const userRole = await getUserRoleFromRequest(request);
    if (!userRole || !['superadmin', 'owner', 'manager'].includes(userRole)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const updateData: Partial<CreateVariantRequest> = body;

    // Check if variant exists and user has access
    const { data: existingVariant, error: variantError } = await supabase
      .from('product_variants')
      .select('id, product_id, sku')
      .eq('id', variantId)
      .eq('product_id', productId)
      .eq('tenant_id', tenant.id)
      .single();

    if (variantError || !existingVariant) {
      return NextResponse.json(
        { error: 'Variant not found' },
        { status: 404 }
      );
    }

    // Check for duplicate SKU if being updated
    if (updateData.sku && updateData.sku !== existingVariant.sku) {
      const { data: existingSku } = await supabase
        .from('product_variants')
        .select('id')
        .eq('sku', updateData.sku.trim().toUpperCase())
        .eq('tenant_id', tenant.id)
        .neq('id', variantId)
        .single();

      if (existingSku) {
        return NextResponse.json(
          { error: 'SKU already exists' },
          { status: 409 }
        );
      }
    }

    // Prepare update data
    const cleanUpdateData: Record<string, any> = {};
    
    if (updateData.name !== undefined) {
      cleanUpdateData.name = updateData.name.trim();
    }
    if (updateData.description !== undefined) {
      cleanUpdateData.description = updateData.description?.trim() || null;
    }
    if (updateData.sku !== undefined) {
      cleanUpdateData.sku = updateData.sku?.trim().toUpperCase() || null;
    }
    if (updateData.price_adjustment_cents !== undefined) {
      cleanUpdateData.price_adjustment_cents = updateData.price_adjustment_cents;
    }
    if (updateData.weight_grams !== undefined) {
      cleanUpdateData.weight_grams = updateData.weight_grams;
    }
    if (updateData.volume_ml !== undefined) {
      cleanUpdateData.volume_ml = updateData.volume_ml;
    }
    if (updateData.is_active !== undefined) {
      cleanUpdateData.is_active = updateData.is_active;
    }
    if (updateData.attributes !== undefined) {
      cleanUpdateData.attributes = updateData.attributes || {};
    }

    // Update the variant
    const { data: variant, error: updateError } = await supabase
      .from('product_variants')
      .update({
        ...cleanUpdateData,
        updated_at: new Date().toISOString()
      })
      .eq('id', variantId)
      .eq('tenant_id', tenant.id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating variant:', updateError);
      return NextResponse.json(
        { error: 'Failed to update variant' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      variant
    });

  } catch (error) {
    console.error('Error in variant PUT handler:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { productId: string; variantId: string } }
) {
  try {
    const { productId, variantId } = params;
    const supabase = createServerComponentClient<Database>({ cookies });
    const tenant = await getTenantFromHeaders(request);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Check user permissions
    const userRole = await getUserRoleFromRequest(request);
    if (!userRole || !['superadmin', 'owner', 'manager'].includes(userRole)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Check if variant exists and user has access
    const { data: existingVariant, error: variantError } = await supabase
      .from('product_variants')
      .select('id, name')
      .eq('id', variantId)
      .eq('product_id', productId)
      .eq('tenant_id', tenant.id)
      .single();

    if (variantError || !existingVariant) {
      return NextResponse.json(
        { error: 'Variant not found' },
        { status: 404 }
      );
    }

    // Check if variant is being used in any bookings/orders
    const { data: bookingItems } = await supabase
      .from('booking_items')
      .select('id')
      .eq('variant_id', variantId)
      .eq('tenant_id', tenant.id)
      .limit(1);

    if (bookingItems && bookingItems.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete variant that is used in bookings' },
        { status: 409 }
      );
    }

    // Soft delete the variant (set is_active to false) instead of hard delete
    const { error: deleteError } = await supabase
      .from('product_variants')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', variantId)
      .eq('tenant_id', tenant.id);

    if (deleteError) {
      console.error('Error deleting variant:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete variant' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Variant deleted successfully'
    });

  } catch (error) {
    console.error('Error in variant DELETE handler:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

  } catch (error) {
    console.error('Product variant update API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/products/[productId]/variants/[variantId]
 * Delete a specific product variant
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user role and permissions
    const userRole = await getUserRole(user.id);
    const permissions = PRODUCT_ROLE_PERMISSIONS[userRole];
    
    if (!permissions.can_edit_products) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Get user's tenant(s)
    const { data: tenantUsers } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', user.id);

    if (!tenantUsers || tenantUsers.length === 0) {
      return NextResponse.json({ error: 'No tenant access' }, { status: 403 });
    }

    const tenantIds = tenantUsers.map(tu => tu.tenant_id);

    // Verify variant exists and user has access
    const { data: existingVariant } = await supabase
      .from('product_variants')
      .select('id, tenant_id, variant_name, stock_quantity')
      .eq('id', params.variantId)
      .eq('product_id', params.productId)
      .in('tenant_id', tenantIds)
      .single();

    if (!existingVariant) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    }

    // Check for URL parameter to determine deletion strategy
    const url = new URL(req.url);
    const forceDelete = url.searchParams.get('force') === 'true';

    if (!forceDelete) {
      // Soft delete - set is_active to false
      const { data: updatedVariant, error } = await supabase
        .from('product_variants')
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', params.variantId)
        .select('id, variant_name, is_active')
        .single();

      if (error) {
        console.error('Product variant soft deletion error:', error);
        return NextResponse.json({ error: 'Failed to deactivate variant' }, { status: 500 });
      }

      return NextResponse.json({ 
        message: 'Product variant deactivated successfully',
        variant: updatedVariant 
      });
    } else {
      // Hard delete - check for inventory first
      if (existingVariant.stock_quantity > 0) {
        return NextResponse.json({
          error: 'Cannot delete variant with stock',
          details: { 
            message: 'Variant has stock quantity > 0. Reduce stock to zero before deletion.',
            current_stock: existingVariant.stock_quantity
          }
        }, { status: 409 });
      }

      // Log inventory movement for stock reduction if needed
      if (existingVariant.stock_quantity > 0) {
        await supabase
          .from('inventory_movements')
          .insert({
            tenant_id: existingVariant.tenant_id,
            product_id: params.productId,
            variant_id: params.variantId,
            movement_type: 'adjustment',
            quantity_change: -existingVariant.stock_quantity,
            previous_quantity: existingVariant.stock_quantity,
            new_quantity: 0,
            reason: 'Variant deletion - stock cleared',
            performed_by: user.id,
          });
      }

      // Hard delete
      const { error } = await supabase
        .from('product_variants')
        .delete()
        .eq('id', params.variantId);

      if (error) {
        console.error('Product variant deletion error:', error);
        return NextResponse.json({ error: 'Failed to delete variant' }, { status: 500 });
      }

      return NextResponse.json({ 
        message: 'Product variant permanently deleted',
        variant_id: params.variantId 
      });
    }

  } catch (error) {
    console.error('Product variant deletion API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}