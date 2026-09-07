import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

export type EncryptedMetaCredential = {
  encryptedApiKey: string;
  encryptionIv: string;
  encryptionKeyVersion: string;
};

function getEncryptionKey(): Buffer {
  const configured = process.env.ENCRYPTION_KEY?.trim() || '';
  if (!configured) throw new Error('ENCRYPTION_KEY is required to store Meta credentials');

  const key = /^[0-9a-f]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64');

  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a 32-byte hex or base64 value');
  }
  return key;
}

function keyVersion(key: Buffer): string {
  return `aes-256-gcm:${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

/** Encrypts a credential with the server-only persistent encryption key. */
export function encryptMetaCredential(value: string): EncryptedMetaCredential {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encryptedApiKey: Buffer.concat([ciphertext, tag]).toString('base64'),
    encryptionIv: iv.toString('base64'),
    encryptionKeyVersion: keyVersion(key),
  };
}

/** Decrypts a credential stored by encryptMetaCredential. Never call from client code. */
export function decryptMetaCredential(input: EncryptedMetaCredential): string {
  const key = getEncryptionKey();
  const payload = Buffer.from(input.encryptedApiKey, 'base64');
  if (payload.length < 17) throw new Error('Invalid encrypted Meta credential');
  const ciphertext = payload.subarray(0, -16);
  const tag = payload.subarray(-16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(input.encryptionIv, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
