import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
  getSupabaseRouteHandlerClient: jest.fn(() => ({})),
}));

jest.mock('@/lib/redis', () => ({
  isRedisConfigured: jest.fn(() => false),
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
}));

jest.mock('@/lib/monitoring/alerting', () => ({
  getAlertService: jest.fn(() => ({ sendErrorAlert: jest.fn().mockResolvedValue(undefined) })),
}));

jest.mock('@/lib/logger/api-logger', () => ({
  createApiLogger: jest.fn(() => ({
    logRequest: jest.fn(),
    logError: jest.fn(),
    warn: jest.fn(),
  })),
}));

jest.mock('@/lib/logger', () => ({
  defaultLogger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { cacheGet, cacheSet, isRedisConfigured } from '@/lib/redis';
import { POST } from '@/app/api/public/booka/revenue-requests/route';

type InsertResult = {
  data: Record<string, unknown> | null;
  error: { code?: string; message: string } | null;
};

function adminClient(options?: {
  insertResult?: InsertResult;
  existingResult?: InsertResult;
}) {
  const insertResult = options?.insertResult ?? {
    data: { id: 'req_1', request_type: 'revenue_pilot', status: 'new' },
    error: null,
  };
  const existingResult = options?.existingResult ?? {
    data: { id: 'req_existing', request_type: 'revenue_pilot', status: 'qualified' },
    error: null,
  };

  const insert = jest.fn((payload: Record<string, unknown>) => ({
    select: jest.fn(() => ({
      single: jest.fn(async () => insertResult),
    })),
    payload,
  }));

  const existingQuery = {
    eq: jest.fn(),
    not: jest.fn(),
    maybeSingle: jest.fn(async () => existingResult),
  };
  existingQuery.eq.mockReturnValue(existingQuery);
  existingQuery.not.mockReturnValue(existingQuery);

  return {
    insert,
    client: {
      from: jest.fn(() => ({
        insert,
        select: jest.fn(() => existingQuery),
      })),
    },
  };
}

const validRequest = {
  request_type: 'revenue_pilot',
  business_name: '  Ada Beauty Studio  ',
  contact_name: '  Ada Okafor  ',
  email: '  ADA@EXAMPLE.COM ',
  phone: ' +234 800 000 0000 ',
  vertical: 'beauty',
  weekly_enquiry_band: '50_99',
  channels: ['whatsapp', 'instagram'],
  average_transaction_value_ngn: 25000,
  current_conversion_band: '25_49',
  instagram_handle: '@adabeauty',
  website_url: 'https://example.com',
  consent_to_contact: true,
  sample_review_consent: false,
  company_website: '',
};

function request(body: Record<string, unknown>, ip = '203.0.113.8') {
  return new NextRequest('http://localhost/api/public/booka/revenue-requests', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/public/booka/revenue-requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isRedisConfigured as jest.Mock).mockReturnValue(false);
  });

  it('accepts a consented beauty pilot request and inserts normalized fields', async () => {
    const admin = adminClient();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(admin.client);

    const response = await POST(request(validRequest));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 'req_1',
      request_type: 'revenue_pilot',
      status: 'new',
    });
    expect(admin.insert).toHaveBeenCalledWith(expect.objectContaining({
      business_name: 'Ada Beauty Studio',
      contact_name: 'Ada Okafor',
      email: 'ada@example.com',
      phone: '+234 800 000 0000',
      vertical: 'beauty',
    }));
  });

  it('accepts a missed-revenue-report request without raw conversation content', async () => {
    const admin = adminClient({
      insertResult: {
        data: { id: 'req_2', request_type: 'missed_revenue_report', status: 'new' },
        error: null,
      },
    });
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(admin.client);

    const response = await POST(request({
      ...validRequest,
      request_type: 'missed_revenue_report',
      sample_review_consent: true,
      conversation: 'customer message',
      messages: ['private'],
      chat_sample: 'private',
      customer_data: { name: 'Customer' },
    }));

    expect(response.status).toBe(200);
    const payload = admin.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('conversation');
    expect(payload).not.toHaveProperty('messages');
    expect(payload).not.toHaveProperty('chat_sample');
    expect(payload).not.toHaveProperty('customer_data');
  });

  it('rejects consent_to_contact=false', async () => {
    const admin = adminClient();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(admin.client);

    const response = await POST(request({ ...validRequest, consent_to_contact: false }));

    expect(response.status).toBe(400);
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it('rejects other vertical without other_vertical', async () => {
    const admin = adminClient();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(admin.client);

    const response = await POST(request({ ...validRequest, vertical: 'other' }));

    expect(response.status).toBe(400);
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it('rejects an empty channels array', async () => {
    const admin = adminClient();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(admin.client);

    const response = await POST(request({ ...validRequest, channels: [] }));

    expect(response.status).toBe(400);
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it('returns success without inserting when the honeypot field is populated', async () => {
    const admin = adminClient();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(admin.client);

    const response = await POST(request({ ...validRequest, company_website: 'spam.example' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'accepted' });
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it('rejects the sixth request from one IP inside an hour when Redis is configured', async () => {
    const admin = adminClient();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(admin.client);
    (isRedisConfigured as jest.Mock).mockReturnValue(true);
    (cacheGet as jest.Mock).mockResolvedValue(5);

    const response = await POST(request(validRequest));

    expect(response.status).toBe(429);
    expect(cacheSet).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it('returns the existing open request when the unique contact constraint is hit', async () => {
    const admin = adminClient({
      insertResult: {
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      },
      existingResult: {
        data: { id: 'req_existing', request_type: 'revenue_pilot', status: 'qualified' },
        error: null,
      },
    });
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(admin.client);

    const response = await POST(request(validRequest));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 'req_existing',
      request_type: 'revenue_pilot',
      status: 'qualified',
    });
  });
});
