/**
 * STT (Speech-to-Text) abstraction
 * Providers: openai (Whisper API) | local (whisper.cpp sidecar)
 */

export type SttProvider = 'openai' | 'local';

export interface SttResult {
  text: string;
  duration_ms?: number;
}

/**
 * Transcribe audio to text.
 * @param audioBuffer - raw audio bytes (e.g. ogg/opus from WhatsApp)
 * @param provider - 'openai' (default) or 'local'
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  provider: SttProvider = 'openai'
): Promise<SttResult> {
  if (provider === 'local') {
    return transcribeLocal(audioBuffer);
  }
  return transcribeOpenAI(audioBuffer);
}

async function transcribeOpenAI(audioBuffer: Buffer): Promise<SttResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer.buffer as ArrayBuffer], { type: 'audio/ogg' }), 'audio.ogg');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI STT error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { text: string };
  return { text: data.text };
}

async function transcribeLocal(audioBuffer: Buffer): Promise<SttResult> {
  const endpoint = process.env.WHISPER_LOCAL_URL ?? 'http://localhost:9000/asr';

  const formData = new FormData();
  formData.append('audio_file', new Blob([audioBuffer.buffer as ArrayBuffer], { type: 'audio/ogg' }), 'audio.ogg');
  formData.append('encode', 'true');
  formData.append('task', 'transcribe');
  formData.append('output', 'json');

  const res = await fetch(endpoint, { method: 'POST', body: formData });
  if (!res.ok) {
    throw new Error(`Local Whisper error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { text: string };
  return { text: data.text };
}
