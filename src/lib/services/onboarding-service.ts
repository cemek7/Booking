import { defaultLogger } from '@/lib/logger';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { ensureTenantWahaProvisioning } from '@/lib/whatsapp/wahaProvisioning';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { captureServerAnalyticsEvent } from '@/lib/analytics/server';
import { captureBookaException } from '@/lib/observability/sentry';

interface Service {
  name: string;
  duration?: number;
  price?: number;
  category?: string;
}

interface Staff {
  name?: string;
  email?: string;
  phone?: string;
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

interface TenantRow {
  id: string;
  slug: string | null;
}

export async function createTenant(
  supabase: SupabaseClient,
  userId: string,
  tenantDetails: {
    name: string;
    industry?: string;
    business_type?: string;
    timezone?: string;
    description?: string;
    services?: Service[];
    staff?: Staff[];
  }
) {
  const { name, industry, business_type, timezone, services = [], staff = [] } = tenantDetails;

  // Create tenant (columns added by migration 040: slug, industry, timezone, business_type)
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
    .select('id, slug')
    .single<TenantRow>();

  if (tenantError || !tenant) {
    defaultLogger.error('[onboarding] tenant insert failed', {
      code: tenantError?.code,
      message: tenantError?.message,
    });
    throw new Error('Failed to create tenant');
  }

  // Create owner membership
  const { error: ownerError } = await supabase
    .from('tenant_users')
    .insert({ tenant_id: tenant.id, user_id: userId, role: 'owner' });

  if (ownerError) {
    // Compensating cleanup: remove the tenant row
    const { error: cleanupError } = await supabase.from('tenants').delete().eq('id', tenant.id);
    if (cleanupError) defaultLogger.error('Tenant cleanup failed after owner link error:', cleanupError);
    throw new Error('Failed to link owner to tenant');
  }

  try {
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
      const { error: servicesError } = await supabase.from('services').insert(serviceRows);
      if (servicesError) {
        defaultLogger.error('Failed to seed services:', servicesError);
        throw new Error('Failed to seed services');
      }
    }

    // Seed staff + default Monday–Friday 9-17 availability slots for each staff member
    if (staff.length > 0) {
      const staffRows = staff.map(s => ({
        tenant_id: tenant.id,
        email: s.email,
        name: s.name,
        phone: s.phone ?? null,
        role: s.role || 'staff',
      }));
      const { data: insertedStaff, error: staffInsertError } = await supabase
        .from('tenant_users')
        .insert(staffRows)
        .select('user_id');
      if (staffInsertError) {
        defaultLogger.error('Failed to seed staff members:', staffInsertError);
        throw new Error('Failed to seed staff members');
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
            defaultLogger.error('Failed to seed staff schedules:', scheduleInsertError);
            throw new Error('Failed to seed staff schedules');
          }
        }
      }
    }
  } catch (seedError) {
    // Compensating cleanup: remove all rows inserted for this tenant so we leave no partial state
    // Delete in reverse dependency order: staff_schedules (refs tenant_users) → services → tenant_users → tenants
    const cleanupSteps = [
      () => supabase.from('staff_schedules').delete().eq('tenant_id', tenant.id),
      () => supabase.from('services').delete().eq('tenant_id', tenant.id),
      () => supabase.from('tenant_users').delete().eq('tenant_id', tenant.id),
      () => supabase.from('tenants').delete().eq('id', tenant.id),
    ];
    for (const step of cleanupSteps) {
      const { error } = await step();
      if (error) defaultLogger.error('Tenant compensating cleanup error:', error);
    }
    throw seedError;
  }

  try {
    await ensureTenantWahaProvisioning(supabase, tenant.id, name);
  } catch (error) {
    const mustSucceed = process.env.WAHA_AUTO_PROVISION_REQUIRED === 'true';
    defaultLogger.error('[onboarding] WAHA auto-provisioning failed', {
      tenantId: tenant.id,
      mustSucceed,
      error: error instanceof Error ? error.message : String(error),
    });
    captureBookaException(error, {
      tenantId: tenant.id,
      flow: 'activation',
      provider: 'waha',
      extra: { mustSucceed },
    });
    if (mustSucceed) {
      throw new Error('Failed to auto-provision WhatsApp endpoint');
    }
  }

  await captureServerAnalyticsEvent({
    event: ANALYTICS_EVENTS.TENANT_CREATED,
    properties: {
      tenant_id: tenant.id,
      business_category: industry ?? business_type ?? null,
      flow: 'activation',
      channel: 'web',
      staff_count: staff.length,
      metadata: {
        slug,
        services_seeded: services.length,
        staff_seeded: staff.length,
        timezone: timezone ?? 'UTC',
      },
    },
    distinctId: userId,
  });

  return { tenantId: tenant.id, slug };
}
