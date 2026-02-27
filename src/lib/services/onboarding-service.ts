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

/** Generate a URL-safe slug from a business name + short id suffix. */
function generateSlug(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base}-${id.slice(0, 6)}`;
}

export async function createTenant(
  supabase: SupabaseClient,
  userId: string,
  tenantDetails: {
    name: string;
    industry?: string;
    business_type?: string;
    timezone?: string;
    services?: Service[];
    staff?: Staff[];
  }
) {
  const { name, industry, business_type, timezone, services = [], staff = [] } = tenantDetails;

  // Create tenant — store all schema columns added in migration 040
  const tenantId = randomUUID();
  const slug = generateSlug(name, tenantId);
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({
      id: tenantId,
      name,
      slug,
      industry: industry ?? null,
      business_type: business_type ?? null,
      timezone: timezone ?? 'UTC',
    })
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

  // Seed staff + default Monday–Friday 9-17 availability slots for each staff member
  if (staff.length > 0) {
    const staffRows = staff.map(s => ({
      tenant_id: tenant.id,
      email: s.email,
      name: s.name,
      role: s.role || 'staff',
      status: s.status || 'active',
    }));
    const { data: insertedStaff, error: staffInsertError } = await supabase
      .from('tenant_users')
      .insert(staffRows)
      .select('user_id');
    if (staffInsertError) {
      throw new Error(`Failed to seed staff members: ${staffInsertError.message}`);
    }

    // Seed default weekly availability for each seeded staff member (Mon–Fri, 09:00–17:00)
    if (insertedStaff && insertedStaff.length > 0) {
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
      const scheduleRows: object[] = [];
      for (const s of insertedStaff) {
        if (!s.user_id) continue;
        for (const day of days) {
          scheduleRows.push({
            tenant_id: tenant.id,
            staff_user_id: s.user_id,
            day_of_week: day,
            start_time: '09:00',
            end_time: '17:00',
            is_available: true,
          });
        }
      }
      if (scheduleRows.length > 0) {
        // staff_schedules table created in migration 027
        const { error: scheduleInsertError } = await supabase.from('staff_schedules').insert(scheduleRows);
        if (scheduleInsertError) {
          throw new Error(`Failed to seed staff schedules: ${scheduleInsertError.message}`);
        }
      }
    }
  }

  return { tenantId: tenant.id, slug };
}
