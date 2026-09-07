import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchExecute, dispatchValidate, HANDLERS, type ActionHandler } from './registry';

const admin = {} as SupabaseClient;

describe('handler registry', () => {
  beforeEach(() => {
    Object.keys(HANDLERS).forEach((key) => {
      delete HANDLERS[key];
    });
  });

  it('returns handled true when a handler exists', async () => {
    const validate = jest.fn(async () => ({ valid: true }));
    const execute = jest.fn(async () => ({ success: true, reply: 'ok' }));
    const handler: ActionHandler = {
      action: 'test_action',
      requiresConfirmation: false,
      validate,
      execute,
    };
    HANDLERS.test_action = handler;

    const validated = await dispatchValidate(admin, 'tenant-1', 'test_action', {}, {});
    const executed = await dispatchExecute(admin, 'tenant-1', 'test_action', {}, {});

    expect(validated.handled).toBe(true);
    expect(validated.result).toEqual({ valid: true });
    expect(executed.handled).toBe(true);
    expect(executed.result).toEqual({ success: true, reply: 'ok' });
  });

  it('returns handled false when no handler exists', async () => {
    const validated = await dispatchValidate(admin, 'tenant-1', 'unknown', {}, {});
    const executed = await dispatchExecute(admin, 'tenant-1', 'unknown', {}, {});

    expect(validated).toEqual({ handled: false });
    expect(executed).toEqual({ handled: false });
  });
});
