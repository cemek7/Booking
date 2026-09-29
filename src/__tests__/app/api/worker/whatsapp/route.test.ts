const mockClaim = jest.fn();
const mockComplete = jest.fn();
const mockRetry = jest.fn();
const mockProcess = jest.fn();
const mockAlert = jest.fn();

jest.mock('@/lib/whatsapp/v2/queueBatch', () => ({
  claimNextConversationBatch: (...args: unknown[]) => mockClaim(...args),
  completeConversationBatch: (...args: unknown[]) => mockComplete(...args),
  retryConversationBatch: (...args: unknown[]) => mockRetry(...args),
}));
jest.mock('@/lib/whatsapp/v2/pipeline', () => ({
  processConversationBatch: (...args: unknown[]) => mockProcess(...args),
}));
jest.mock('@/lib/monitoring/telegramAlert', () => ({
  sendTelegramAlert: (...args: unknown[]) => mockAlert(...args),
}));

import { GET } from '@/app/api/worker/whatsapp/route';
import type { ClaimedConversationBatch } from '@/lib/whatsapp/v2/queueBatch';

const batch: ClaimedConversationBatch = {
  batchId: 'batch-1', workerId: 'worker-from-claim', tenantId: 'tenant-1',
  channel: 'whatsapp', externalId: '+2348031234567', conversationId: 'conversation-1',
  threadId: 'thread-1', combinedText: 'hello', correlationKey: 'conversation-batch:abc',
  rows: [{
    id: 'queue-1', tenantId: 'tenant-1', channel: 'whatsapp', externalId: '+2348031234567',
    conversationId: 'conversation-1', threadId: 'thread-1', content: 'hello', messageId: 'message-1',
    providerTimestamp: '2026-09-28T12:00:00.000Z', createdAt: '2026-09-28T12:00:00.100Z',
    batchId: 'batch-1', leaseOwner: 'worker-from-claim', retryCount: 0, maxRetries: 3,
  }],
};

function request(auth = 'Bearer cron-secret') {
  return { headers: new Headers({ authorization: auth }) } as Request;
}

describe('conversation batch worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    process.env.CRON_SECRET = 'cron-secret';
    mockComplete.mockResolvedValue(undefined);
    mockRetry.mockResolvedValue(undefined);
    mockAlert.mockResolvedValue(undefined);
  });

  it('claims, processes, and completes one leased batch before polling again', async () => {
    mockClaim.mockResolvedValueOnce(batch).mockResolvedValueOnce(null);
    mockProcess.mockResolvedValue({ disposition: 'complete', correlationKey: batch.correlationKey });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ processed: 1, errors: 0 });
    expect(mockProcess).toHaveBeenCalledWith(batch);
    expect(mockComplete).toHaveBeenCalledWith(batch);
    expect(mockClaim).toHaveBeenCalledTimes(2);
    const firstWorker = mockClaim.mock.calls[0][0].workerId;
    expect(mockClaim.mock.calls[1][0].workerId).toBe(firstWorker);
  });

  it('releases only the failed leased batch to retry with backoff', async () => {
    mockClaim.mockResolvedValueOnce(batch).mockResolvedValueOnce(null);
    mockProcess.mockRejectedValue(new Error('provider timeout'));

    const response = await GET(request());

    expect(await response.json()).toMatchObject({ processed: 0, errors: 1 });
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockRetry).toHaveBeenCalledWith(batch, expect.objectContaining({
      errorMessage: 'provider timeout', terminal: false, scheduledAt: expect.any(Date),
    }));
  });

  it('fails closed when the claim RPC is unavailable', async () => {
    mockClaim.mockRejectedValue(Object.assign(new Error('claim function missing'), { code: '42883' }));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'claim function missing' });
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated production calls before claiming', async () => {
    const response = await GET(request('Bearer wrong'));
    expect(response.status).toBe(401);
    expect(mockClaim).not.toHaveBeenCalled();
  });
});
