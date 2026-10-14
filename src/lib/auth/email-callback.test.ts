import {
  buildEmailTokenExchangeUrl,
  syncConfirmedLoginEmail,
  verifyEmailTokenHash,
} from './email-callback';

describe('email callback token exchange', () => {
  it('forwards a staging token hash to the server callback on the same host', () => {
    expect(buildEmailTokenExchangeUrl(
      'https://staging.app.techclave.cloud/booka/auth/callback?finalize=1&token_hash=hash_123&type=email',
    )).toBe(
      'https://staging.app.techclave.cloud/api/auth/callback?finalize=1&token_hash=hash_123&type=email',
    );
  });

  it('verifies an email token hash through Supabase auth', async () => {
    const session = { access_token: 'access-token', user: { id: 'user-1', email: 'owner@example.com' } };
    const verifyOtp = jest.fn().mockResolvedValue({ data: { session }, error: null });

    await expect(verifyEmailTokenHash({ verifyOtp }, 'hash_123', 'email')).resolves.toBe(session);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash_123', type: 'email' });
  });

  it('rejects unsupported verification types', async () => {
    const verifyOtp = jest.fn();

    await expect(verifyEmailTokenHash({ verifyOtp }, 'hash_123', 'magiclink')).rejects.toThrow(
      'Unsupported email verification type',
    );
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('syncs every membership only after a confirmed email change', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn(() => ({ eq }));
    const admin = { from: jest.fn(() => ({ update })) };

    await syncConfirmedLoginEmail(
      admin as never,
      { id: 'user-1', email: ' NEW@example.com ' },
      'email_change'
    );

    expect(update).toHaveBeenCalledWith({ email: 'new@example.com' });
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('does not sync other verification types', async () => {
    const admin = { from: jest.fn() };
    await syncConfirmedLoginEmail(
      admin as never,
      { id: 'user-1', email: 'new@example.com' },
      'email'
    );
    expect(admin.from).not.toHaveBeenCalled();
  });
});
