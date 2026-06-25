/**
 * LiveKit service — generate room tokens and call URLs for WebRTC voice calls.
 * Requires: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET env vars.
 */

export interface CallRoom {
  roomId: string;
  callUrl: string;
  token: string;
  expiresAt: string;
}

/**
 * Create a LiveKit room and return a time-limited participant token + call URL.
 * @param tenantId - used as namespace for room naming
 * @param participantIdentity - e.g. phone number of the caller
 * @param ttlSeconds - token validity window (default 10 minutes)
 */
export async function createCallRoom(
  tenantId: string,
  participantIdentity: string,
  ttlSeconds = 600
): Promise<CallRoom> {
  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!livekitUrl || !apiKey || !apiSecret) {
    throw new Error('LiveKit environment variables are not configured (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)');
  }

  const roomId = `${tenantId.slice(0, 8)}-${Date.now()}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  // Generate LiveKit access token using JWT
  const token = await generateLiveKitToken(apiKey, apiSecret, roomId, participantIdentity, ttlSeconds);

  // Build the call URL — points to our browser call UI
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const callUrl = `${appUrl}/voice/${roomId}?token=${encodeURIComponent(token)}`;

  return { roomId, callUrl, token, expiresAt };
}

async function generateLiveKitToken(
  apiKey: string,
  apiSecret: string,
  roomName: string,
  identity: string,
  ttlSeconds: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: apiKey,
    sub: identity,
    iat: now,
    exp: now + ttlSeconds,
    nbf: now,
    video: {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    },
  };

  const base64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const headerB64 = base64url(header);
  const payloadB64 = base64url(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const { createHmac } = await import('crypto');
  const sig = createHmac('sha256', apiSecret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${sig}`;
}
