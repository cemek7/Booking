import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

interface Service {
  name: string;
  duration?: number;
  price?: number;
  category?: string;
}

interface Staff {
  name?: string;
  email?: string;
  role?: 'owner' | 'staff';
  status?: 'active' | 'on_leave';
}

export async function createTenant(
  supabase: SupabaseClient,
  userId: string,
  tenantDetails: {
    name: string;
    business_type?: string;
    timezone?: string;
    services?: Service[];
    staff?: Staff[];
  }
) {
  const { name, business_type, timezone, services = [], staff = [] } = tenantDetails;

  // Create tenant
  const tenantId = randomUUID();
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({ id: tenantId, name, business_type, timezone })
    .select('id')
    .single();

  if (tenantError || !tenant) {
    throw new Error('Failed to create tenant');
  }

  // Create owner membership
  const { error: ownerError } = await supabase
    .from('tenant_users')
    .insert({ tenant_id: tenant.id, user_id: userId, role: 'owner' });

  if (ownerError) {
    throw new Error('Failed to link owner to tenant');
  }

  // Seed services
  if (services.length > 0) {
    const serviceRows = services.map(service => ({
      tenant_id: tenant.id,
      name: service.name,
      duration: service.duration,
      price: service.price,
      category: service.category,
      is_active: true,
    }));
    await supabase.from('services').insert(serviceRows);
  }

  // Seed staff
  if (staff.length > 0) {
    const staffRows = staff.map(s => ({
      tenant_id: tenant.id,
      email: s.email,
      name: s.name,
      role: s.role || 'staff',
      status: s.status || 'active',
    }));
    await supabase.from('tenant_users').insert(staffRows);
  }

  return { tenantId: tenant.id };
}
