import { appendPendingMessage, claimBatch } from '@/lib/whatsapp/v2/messageBatcher';

describe('legacy JSON message batching compatibility shim', () => {
  it('fails instead of mutating flow_data.pending_messages', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(appendPendingMessage()).rejects.toThrow(
      'Legacy JSON message batching is disabled',
    );
    await expect(claimBatch()).rejects.toThrow(
      'Legacy JSON message batching is disabled',
    );
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('queueBatch'));
    warning.mockRestore();
  });
});
