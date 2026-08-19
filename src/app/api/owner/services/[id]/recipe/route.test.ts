import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCreateSupabaseAdminClient = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => mockCreateSupabaseAdminClient(),
}));

import { GET, PUT } from './route';

const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID_1 = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID_2 = '33333333-3333-4333-8333-333333333333';

function createAdminMock() {
  const recipeItems: Array<Record<string, unknown>> = [];

  return {
    __recipeItems: recipeItems,
    from: jest.fn((table: string) => {
      if (table === 'service_material_recipes') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: '44444444-4444-4444-8444-444444444444',
                    tenant_id: 'tenant-1',
                    service_id: SERVICE_ID,
                    is_active: true,
                    notes: 'Use carefully',
                    service_material_recipe_items: [
                      {
                        id: '55555555-5555-4555-8555-555555555555',
                        product_id: PRODUCT_ID_1,
                        variant_id: null,
                        default_quantity: 2,
                        uom: 'piece',
                        is_optional: false,
                      },
                    ],
                  },
                  error: null,
                }),
              }),
            }),
          }),
          upsert: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: '44444444-4444-4444-8444-444444444444',
                  tenant_id: 'tenant-1',
                  service_id: SERVICE_ID,
                  is_active: true,
                  notes: 'Updated notes',
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'service_material_recipe_items') {
        return {
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
          insert: async (payload: Array<Record<string, unknown>>) => {
            recipeItems.push(...payload);
            return { error: null };
          },
        };
      }

      if (table === 'products') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: [
                  { id: PRODUCT_ID_1, base_uom: 'piece', pack_size: null },
                  { id: PRODUCT_ID_2, base_uom: 'piece', pack_size: 6 },
                ],
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

describe('/api/owner/services/[id]/recipe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the service recipe', async () => {
    mockCreateSupabaseAdminClient.mockReturnValue(createAdminMock());

    const response = await GET({
      request: new Request(`http://localhost/api/owner/services/${SERVICE_ID}/recipe`, { method: 'GET' }),
      supabase: {} as never,
      params: { id: SERVICE_ID },
      user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1', permissions: ['MANAGE_PRODUCTS'] },
    });

    expect(response).toEqual(
      expect.objectContaining({
        recipe: expect.objectContaining({
          id: '44444444-4444-4444-8444-444444444444',
          service_id: SERVICE_ID,
        }),
      }),
    );
  });

  it('rejects non-convertible units loudly', async () => {
    mockCreateSupabaseAdminClient.mockReturnValue(createAdminMock());

    await expect(
      PUT({
        request: {
          method: 'PUT',
          url: `http://localhost/api/owner/services/${SERVICE_ID}/recipe`,
          headers: { get: () => null },
          json: async () => ({
            is_active: true,
            items: [
              {
                product_id: PRODUCT_ID_1,
                default_quantity: 1,
                uom: 'ml',
                is_optional: false,
              },
            ],
          }),
        } as never,
        supabase: {} as never,
        params: { id: SERVICE_ID },
        user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1', permissions: ['MANAGE_PRODUCTS'] },
      }),
    ).rejects.toThrow('Recipe item 1: Cannot convert ml to piece');
  });

  it('saves convertible recipe items', async () => {
    const admin = createAdminMock();
    mockCreateSupabaseAdminClient.mockReturnValue(admin);

    const response = await PUT({
      request: {
        method: 'PUT',
        url: `http://localhost/api/owner/services/${SERVICE_ID}/recipe`,
        headers: { get: () => null },
        json: async () => ({
          is_active: true,
          notes: 'Updated notes',
          items: [
            {
              product_id: PRODUCT_ID_2,
              default_quantity: 2,
              uom: 'pack',
              is_optional: false,
            },
          ],
        }),
      } as never,
      supabase: {} as never,
      params: { id: SERVICE_ID },
      user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1', permissions: ['MANAGE_PRODUCTS'] },
    });

    expect(admin.__recipeItems).toEqual([
      expect.objectContaining({
        tenant_id: 'tenant-1',
        recipe_id: '44444444-4444-4444-8444-444444444444',
        product_id: PRODUCT_ID_2,
        default_quantity: 2,
        uom: 'pack',
      }),
    ]);
    expect(response).toEqual(
      expect.objectContaining({
        recipe: expect.objectContaining({
          id: '44444444-4444-4444-8444-444444444444',
          notes: 'Updated notes',
        }),
      }),
    );
  });
});
