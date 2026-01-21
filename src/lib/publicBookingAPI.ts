'use client';

/**
 * Client-side wrapper for public booking API
 * Used by the booking UI components
 */

interface TimeSlot {
  time: string;
  available: boolean;
}

interface Service {
  id: string;
  name: string;
  description?: string;
  duration: number;
  price: number;
}

interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  industry?: string;
  settings?: Record<string, any>;
}

class PublicBookingAPI {
  async getTenantPublicInfo(slug: string): Promise<TenantInfo> {
    const res = await fetch(`/api/public/${slug}`);
    if (!res.ok) throw new Error('Failed to fetch tenant info');
    return res.json();
  }

  async getTenantServices(slug: string): Promise<Service[]> {
    const res = await fetch(`/api/public/${slug}/services`);
    if (!res.ok) throw new Error('Failed to fetch services');
    return res.json();
  }

  async getAvailability({
    slug,
    serviceId,
    date,
  }: {
    slug: string;
    serviceId: string;
    date: string;
  }): Promise<TimeSlot[]> {
    const params = new URLSearchParams({
      serviceId,
      date,
    });
    const res = await fetch(`/api/public/${slug}/availability?${params}`);
    if (!res.ok) throw new Error('Failed to fetch availability');
    return res.json();
  }

  async createPublicBooking({
    slug,
    serviceId,
    date,
    time,
    customerName,
    customerEmail,
    customerPhone,
    notes,
  }: {
    slug: string;
    serviceId: string;
    date: string;
    time: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    notes?: string;
  }): Promise<{ id: string }> {
    const res = await fetch(`/api/public/${slug}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: serviceId,
        date,
        time,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        notes,
      }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || 'Booking failed');
    }

    return res.json();
  }
}

export const publicBookingAPI = new PublicBookingAPI();
