import { join } from 'path';
import { readFileSync } from 'fs';

type BundleModule = {
  continuityReleaseFiles: string[];
  buildBundle(input: {
    releases: Array<{ path: string; content: string }>;
    verifier: { path: string; content: string };
  }): string;
};

function loadBundleModule(): BundleModule {
  return require(join(
    process.cwd(),
    'scripts/build-conversation-continuity-bundle.cjs',
  )) as BundleModule;
}

describe('conversation continuity SQL bundle', () => {
  it('uses the reviewed release files in the required order', () => {
    const { continuityReleaseFiles } = loadBundleModule();

    expect(continuityReleaseFiles).toEqual([
      'db/releases/2026-09-28-conversation-continuity.sql',
      'db/releases/2026-09-28-channel-identity-runtime-hardening.sql',
      'db/releases/2026-09-28-conversation-ingest-replay-hardening.sql',
      'db/releases/2026-09-29-conversation-effect-delivery-hardening.sql',
      'db/releases/2026-09-29-verified-customer-memory.sql',
      'db/releases/2026-09-29-handoff-thread-continuity.sql',
    ]);
  });

  it('keeps the committed generated artifact synchronized with its sources', () => {
    const { buildBundle, continuityReleaseFiles } = loadBundleModule();
    const generated = readFileSync(
      join(process.cwd(), 'db/releases/2026-09-30-conversation-continuity-all-in-one.sql'),
      'utf8',
    );
    const expected = buildBundle({
      releases: continuityReleaseFiles.map((path) => ({
        path,
        content: readFileSync(join(process.cwd(), path), 'utf8'),
      })),
      verifier: {
        path: 'scripts/sql/verify_conversation_continuity.sql',
        content: readFileSync(
          join(process.cwd(), 'scripts/sql/verify_conversation_continuity.sql'),
          'utf8',
        ),
      },
    });

    expect(generated).toBe(expected);
  });

  it('removes only source transaction lines and preserves post-commit verification', () => {
    const { buildBundle } = loadBundleModule();
    const first = [
      '-- first release',
      'BEGIN;',
      'DO $body$',
      'BEGIN',
      "  RAISE NOTICE 'keep internal begin';",
      'END',
      '$body$;',
      'COMMIT;',
      "SELECT 'first_ready' AS status;",
      '',
    ].join('\n');
    const second = [
      '-- second release',
      'BEGIN;',
      'SELECT 2;',
      'COMMIT;',
      "SELECT 'second_ready' AS status;",
      '',
    ].join('\n');
    const verifier = "SELECT 'all_ready' AS status;\n";

    const output = buildBundle({
      releases: [
        { path: 'first.sql', content: first },
        { path: 'second.sql', content: second },
      ],
      verifier: { path: 'verify.sql', content: verifier },
    });

    expect(output.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(output.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(output).toContain("RAISE NOTICE 'keep internal begin';");
    expect(output).toContain("SELECT 'first_ready' AS status;");
    expect(output).toContain("SELECT 'second_ready' AS status;");
    expect(output.indexOf('-- source: first.sql')).toBeLessThan(output.indexOf('-- source: second.sql'));
    expect(output.indexOf("SELECT 'second_ready' AS status;")).toBeLessThan(
      output.indexOf('-- final verifier: verify.sql'),
    );
    expect(output.indexOf("SELECT 'all_ready' AS status;")).toBeLessThan(output.lastIndexOf('COMMIT;'));
    expect(output).not.toContain('\\i');
    expect(buildBundle({
      releases: [
        { path: 'first.sql', content: first },
        { path: 'second.sql', content: second },
      ],
      verifier: { path: 'verify.sql', content: verifier },
    })).toBe(output);
  });

  it.each([
    ['missing begin', 'SELECT 1;\nCOMMIT;\n'],
    ['missing commit', 'BEGIN;\nSELECT 1;\n'],
    ['duplicate begin', 'BEGIN;\nBEGIN;\nSELECT 1;\nCOMMIT;\n'],
    ['duplicate commit', 'BEGIN;\nSELECT 1;\nCOMMIT;\nCOMMIT;\n'],
    ['commit before begin', 'COMMIT;\nSELECT 1;\nBEGIN;\n'],
  ])('rejects a source with %s', (_label, content) => {
    const { buildBundle } = loadBundleModule();

    expect(() => buildBundle({
      releases: [{ path: 'unsafe.sql', content }],
      verifier: { path: 'verify.sql', content: 'SELECT 1;\n' },
    })).toThrow(/transaction wrapper/i);
  });
});
