import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockRecordMovement = jest.fn();
const mockRecordBusinessEvent = jest.fn();

jest.mock('./recordMovement', () => ({
  recordMovement: (...args: unknown[]) => mockRecordMovement(...args),
}));

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    SERVICE_CONSUMPTION_RECORDED: 'service.consumption_recorded',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

import { consumeForReservation } from './consumeRecipe';

const TENANT_ID = 'tenant-1';
const RESERVATION_ID = 'res-1';
const SERVICE_A = 'service-a';
const SERVICE_B = 'service-b';
const PRODUCT_A = '22222222-2222-4222-8222-222222222222';
const PRODUCT_B = '33333333-3333-4333-8333-333333333333';

function createAdminMock() {
  const inserts: Array<{ table: string; payload: unknown }> = [];

  return {
    __inserts: inserts,
    from: jest.fn((table: string) => {
      if (table === 'reservations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: RESERVATION_ID,
                    service_id: null,
                    tenant_staff_id: 'staff-1',
                    staff_id: 'staff-1',
                    location_id: 'loc-1',
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'reservation_services') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: [
                  { service_id: SERVICE_A, quantity: 2 },
                  { service_id: SERVICE_B, quantity: 1 },
                ],
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'service_material_recipes') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    {
                      id: 'recipe-a',
                      service_id: SERVICE_A,
                      is_active: true,
                      service_material_recipe_items: [
                        { product_id: PRODUCT_A, variant_id: null, default_quantity: 3, uom: 'piece', is_optional: false },
                      ],
                    },
                    {
                      id: 'recipe-b',
                      service_id: SERVICE_B,
                      is_active: true,
                      service_material_recipe_items: [
                        { product_id: PRODUCT_B, variant_id: null, default_quantity: 1, uom: 'pack', is_optional: false },
                      ],
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'products') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: [
                  { id: PRODUCT_A, base_uom: 'piece', pack_size: null, cost_price_cents: 200 },
                  { id: PRODUCT_B, base_uom: 'piece', pack_size: 6, cost_price_cents: 150 },
                ],
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'service_consumption_records') {
        return {
          insert: async (payload: unknown) => {
            inserts.push({ table, payload });
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  } as unknown as SupabaseClient & {
    __inserts: Array<{ table: string; payload: unknown }>;
  };
}

describe('consumeForReservation', () => {
  beforeEach(() => {
    mockRecordMovement.mockReset();
    mockRecordBusinessEvent.mockReset();
    mockRecordMovement
      .mockResolvedValueOnce({ data: [{ movement_id: 'move-1' }], error: null })
      .mockResolvedValueOnce({ data: [{ movement_id: 'move-2' }], error: null });
  });

  it('posts service consumption movements and records for each recipe item across service lines', async () => {
    const admin = createAdminMock();

    await consumeForReservation(admin, TENANT_ID, RESERVATION_ID, 'user-1');

    expect(mockRecordMovement).toHaveBeenNthCalledWith(
      1,
      admin,
      expect.objectContaining({
        tenantId: TENANT_ID,
        productId: PRODUCT_A,
        movementType: 'service_consumption',
        quantityChange: -6,
        referenceType: 'reservation',
        referenceId: RESERVATION_ID,
        locationId: 'loc-1',
      }),
    );

    expect(mockRecordMovement).toHaveBeenNthCalledWith(
      2,
      admin,
      expect.objectContaining({
        tenantId: TENANT_ID,
        productId: PRODUCT_B,
        movementType: 'service_consumption',
        quantityChange: -6,
        referenceType: 'reservation',
        referenceId: RESERVATION_ID,
        locationId: 'loc-1',
      }),
    );

    expect(admin.__inserts).toEqual([
      {
        table: 'service_consumption_records',
        payload: [
          expect.objectContaining({
            tenant_id: TENANT_ID,
            reservation_id: RESERVATION_ID,
            service_id: SERVICE_A,
            product_id: PRODUCT_A,
            planned_quantity: 6,
            actual_quantity: 6,
            uom: 'piece',
            movement_id: 'move-1',
          }),
          expect.objectContaining({
            tenant_id: TENANT_ID,
            reservation_id: RESERVATION_ID,
            service_id: SERVICE_B,
            product_id: PRODUCT_B,
            planned_quantity: 1,
            actual_quantity: 1,
            uom: 'pack',
            movement_id: 'move-2',
          }),
        ],
      },
    ]);

    expect(mockRecordBusinessEvent).toHaveBeenCalledTimes(2);
    expect(mockRecordBusinessEvent).toHaveBeenNthCalledWith(
      1,
      admin,
      expect.objectContaining({
        action: 'service.consumption_recorded',
        entityId: RESERVATION_ID,
        metadata: expect.objectContaining({
          product_id: PRODUCT_A,
          planned_quantity: 6,
          actual_quantity: 6,
          variance_quantity: 0,
        }),
      }),
    );
  });
});
