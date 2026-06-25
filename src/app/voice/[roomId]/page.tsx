"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Browser WebRTC call UI.
 * Joins a LiveKit room using the token from the URL query param.
 * This is a lightweight UI — it requests mic access, connects to the room,
 * and provides controls to mute / end the call.
 */
export default function VoiceCallPage() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';

  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'ended' | 'error'>('idle');
  const [muted, setMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const roomRef = useRef<unknown>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMsg('No call token provided. Please use the link sent to you on WhatsApp.');
      return;
    }
    connectToRoom();
    return () => { leaveRoom(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function connectToRoom() {
    try {
      setStatus('connecting');

      const voiceFeatureEnabled = process.env.NEXT_PUBLIC_ENABLE_VOICE_CALLS === 'true';
      if (!voiceFeatureEnabled) {
        throw new Error('Voice calling is not enabled in this deployment.');
      }

      throw new Error('Voice calling is not available in this build. Please connect the LiveKit client dependency before enabling this route.');
    } catch (e) {
      setStatus('error');
      setErrorMsg((e as Error).message);
    }
  }

  async function leaveRoom() {
    try {
      const room = roomRef.current as { disconnect?: () => void } | null;
      room?.disconnect?.();
    } catch { /* ignore */ }
    setStatus('ended');
  }

  async function toggleMute() {
    try {
      const room = roomRef.current as { localParticipant: { setMicrophoneEnabled: (v: boolean) => Promise<void>; isMicrophoneEnabled: boolean } } | null;
      if (!room) return;
      const next = !muted;
      await room.localParticipant.setMicrophoneEnabled(!next);
      setMuted(next);
    } catch { /* ignore */ }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6 text-white">
      <div className="w-full max-w-sm bg-gray-800 rounded-2xl p-8 space-y-6 text-center shadow-xl">
        <div className="text-4xl">
          {status === 'connected' ? '📞' : status === 'ended' ? '📵' : status === 'error' ? '❌' : '⏳'}
        </div>

        <h1 className="text-xl font-semibold">
          {status === 'idle' && 'Preparing call…'}
          {status === 'connecting' && 'Connecting…'}
          {status === 'connected' && 'Call in progress'}
          {status === 'ended' && 'Call ended'}
          {status === 'error' && 'Call failed'}
        </h1>

        {status === 'error' && (
          <p className="text-sm text-red-300">{errorMsg}</p>
        )}

        {status === 'connected' && (
          <p className="text-sm text-gray-400">
            Speak naturally — the AI agent is listening and will respond with voice.
          </p>
        )}

        {status === 'ended' && (
          <p className="text-sm text-gray-400">
            Your call has ended. Check WhatsApp for a summary and any booking details.
          </p>
        )}

        {(status === 'connected' || status === 'connecting') && (
          <div className="flex gap-3 justify-center">
            <button
              onClick={toggleMute}
              disabled={status !== 'connected'}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm disabled:opacity-50"
            >
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              onClick={leaveRoom}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-sm"
            >
              End Call
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
