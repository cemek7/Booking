async function requestCorroboration(input, env = process.env) {
  const apiKey = env.TECHCLAVE_GATE_OPENAI_API_KEY;
  if (!apiKey) return { status: 'disabled' };

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.TECHCLAVE_GATE_OPENAI_MODEL || 'gpt-5-mini',
        input: [{ role: 'developer', content: 'Return concise corroborating security evidence only.' }, { role: 'user', content: input.text }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { status: 'failed', reason: `http_${response.status}` };
    return { status: 'ok', response: await response.json() };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.name : 'unknown_error' };
  }
}

module.exports = { requestCorroboration };
