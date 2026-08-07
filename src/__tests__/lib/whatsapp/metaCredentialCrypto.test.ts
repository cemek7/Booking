import { decryptMetaCredential, encryptMetaCredential } from '@/lib/whatsapp/metaCredentialCrypto';

describe('Meta credential encryption', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  it('round-trips a token without retaining plaintext in the envelope', () => {
    const token = 'EAABookaMetaToken';
    const encrypted = encryptMetaCredential(token);

    expect(encrypted.encryptedApiKey).not.toContain(token);
    expect(encrypted.encryptionIv).not.toHaveLength(0);
    expect(decryptMetaCredential(encrypted)).toBe(token);
  });

  it('rejects an invalid persistent encryption key', () => {
    process.env.ENCRYPTION_KEY = 'not-a-32-byte-key';
    expect(() => encryptMetaCredential('token')).toThrow(/32-byte/);
  });
});
