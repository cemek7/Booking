import { writeAuditLog } from '@/lib/audit/log';

function makeAdmin() {
  const insert = jest.fn().mockResolvedValue({ error: null });
  return { admin: { from: jest.fn(() => ({ insert })) }, insert };
}

describe('writeAuditLog', () => {
  it('inserts an audit row with action/tenant/metadata', async () => {
    const { admin, insert } = makeAdmin();
    await writeAuditLog(admin as any, {
      action: 'tenant.offboard.scheduled',
      tenantId: 't1', userId: 'u1', userRole: 'owner',
      result: 'success', metadata: { reason: 'voluntary' },
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'tenant.offboard.scheduled', tenant_id: 't1',
      user_id: 'u1', user_role: 'owner', result: 'success',
      metadata: { reason: 'voluntary' },
    }));
  });

  it('never throws — audit failures are swallowed and logged', async () => {
    const admin = { from: jest.fn(() => ({ insert: jest.fn().mockResolvedValue({ error: { message: 'x' } }) })) };
    await expect(writeAuditLog(admin as any, { action: 'a', tenantId: 't' })).resolves.toBeUndefined();
  });
});
