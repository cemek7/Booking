const { redactForReasoner } = require('../../scripts/techclave-gate/redact.cjs');

describe('Techclave Gate reasoner redaction', () => {
  it('excludes environment files completely from model input', () => {
    expect(redactForReasoner('+ KEY=sk-live-secret\n', ['.env.production']))
      .toEqual({ text: '', excludedFiles: ['.env.production'] });
  });

  it('redacts inline GitHub tokens before model input', () => {
    const result = redactForReasoner(
      '+ const token = "ghp_abcdefghijklmnopqrstuvwxyz1234567890"\n',
      ['src/lib/example.ts'],
    );

    expect(result.text).toContain('[REDACTED_SECRET]');
    expect(result.text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
  });
});
