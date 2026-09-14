import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { execFileSync } from "child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * The runtime-secret generator must never replace a secret that already exists.
 *
 * It used to check .secrets.env alone. Compose reads .env first and
 * .secrets.env second, so a value appended to .secrets.env OVERRIDES one set in
 * .env. On a box whose secrets had been set by hand in .env, the first run
 * rotated all of them. Production came back with a new REDIS_PASSWORD while the
 * running Redis still required the old one, and every page returned 503.
 */

const SCRIPT = join(
  process.cwd(),
  "deployment",
  "scripts",
  "ensure-generated-runtime-secrets.sh",
);

const KEYS = [
  "STOREFRONT_CONTEXT_SECRET",
  "NEXTAUTH_SECRET",
  "ENCRYPTION_KEY",
  "CRON_SECRET",
  "JWT_SECRET",
  "INSTAGRAM_OAUTH_STATE_SECRET",
  "REDIS_PASSWORD",
];

let root: string;
let stack: string;

function run(): void {
  execFileSync("bash", [SCRIPT, "production"], {
    env: { ...process.env, STACK_ROOT: root },
    stdio: "pipe",
  });
}

function secretsFile(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of readFileSync(join(stack, ".secrets.env"), "utf8").split(
    "\n",
  )) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq);
    (out[key] ??= []).push(line.slice(eq + 1));
  }
  return out;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "runtime-secrets-"));
  stack = join(root, "prod");
  mkdirSync(stack);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("ensure-generated-runtime-secrets.sh", () => {
  it("does not shadow a secret already set in .env", () => {
    writeFileSync(
      join(stack, ".env"),
      "REDIS_PASSWORD=set-by-hand\nENCRYPTION_KEY=existing-key\n",
    );

    run();

    const secrets = secretsFile();
    // Anything written here would override .env and rotate the live secret.
    expect(secrets.REDIS_PASSWORD).toBeUndefined();
    expect(secrets.ENCRYPTION_KEY).toBeUndefined();
  });

  it("generates secrets missing from both files", () => {
    writeFileSync(join(stack, ".env"), "APP_PORT=3000\n");

    run();

    const secrets = secretsFile();
    for (const key of KEYS) {
      expect(secrets[key]).toHaveLength(1);
      expect(secrets[key][0]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("preserves an existing .secrets.env value across runs", () => {
    writeFileSync(
      join(stack, ".secrets.env"),
      "REDIS_PASSWORD=already-generated\n",
    );

    run();
    run();

    expect(secretsFile().REDIS_PASSWORD).toEqual(["already-generated"]);
  });

  it("still generates a key whose .env entry is present but empty", () => {
    writeFileSync(join(stack, ".env"), "CRON_SECRET=\n");

    run();

    expect(secretsFile().CRON_SECRET?.[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("works on a box that has no .env file at all", () => {
    run();
    expect(Object.keys(secretsFile()).sort()).toEqual([...KEYS].sort());
  });
});
