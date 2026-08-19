/**
 * TTS (Text-to-Speech) abstraction
 * Providers: openai (OpenAI TTS API) | local (Coqui/Piper sidecar)
 */

export type TtsProvider = 'openai' | 'local';
export type OpenAIVoice = 'alloy' | 'nova' | 'echo' | 'shimmer' | 'onyx' | 'fable';

export interface TtsResult {
  audioBuffer: Buffer;
  contentType: string; // e.g. 'audio/mpeg'
}

/**
 * Synthesise text to audio.
 * @param text - the text to speak
 * @param provider - 'openai' (default) or 'local'
 * @param voice - OpenAI voice character (only relevant for openai provider)
 */
export async function synthesiseSpeech(
  text: string,
  provider: TtsProvider = 'openai',
  voice: OpenAIVoice = 'alloy'
): Promise<TtsResult> {
  if (provider === 'local') {
    return synthesiseLocal(text);
  }
  return synthesiseOpenAI(text, voice);
}

async function synthesiseOpenAI(text: string, voice: OpenAIVoice): Promise<TtsResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice,
      response_format: 'mp3',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI TTS error ${res.status}: ${err}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return { audioBuffer: Buffer.from(arrayBuffer), contentType: 'audio/mpeg' };
}

async function synthesiseLocal(text: string): Promise<TtsResult> {
  const endpoint = process.env.COQUI_TTS_URL ?? 'http://localhost:5002/api/tts';

  const res = await fetch(`${endpoint}?text=${encodeURIComponent(text)}`, {
    method: 'GET',
  });

  if (!res.ok) {
    throw new Error(`Local TTS error ${res.status}: ${await res.text()}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return { audioBuffer: Buffer.from(arrayBuffer), contentType: 'audio/wav' };
}
