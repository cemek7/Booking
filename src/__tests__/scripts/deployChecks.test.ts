import { describe, it, expect } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { PUBLIC_ROUTES } from "@/lib/site/publicRoutes";

/**
 * Guards on the deploy path, each tied to an outage it would have prevented.
 */

const ROOT = process.cwd();
const DEPLOYMENT = join(ROOT, "deployment");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

function shellScripts(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) shellScripts(full, acc);
    else if (entry.endsWith(".sh")) acc.push(full);
  }
  return acc;
}

describe("public route check", () => {
  it("checks exactly the routes the site registers as public", () => {
    const script = read("deployment", "scripts", "check-public-routes.sh");
    const block = /PUBLIC_ROUTES=\(([\s\S]*?)\)/.exec(script);
    expect(block).not.toBeNull();
    const scriptRoutes = block![1]
      .split(/\s+/)
      .map((r) => r.trim())
      .filter(Boolean);

    // A page added to the site but not to the live check would ship even if
    // the proxy never forwards it — which is how the legal pages 404'd.
    expect([...scriptRoutes].sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  it("waits for readiness, not liveness", () => {
    const code = read("deployment", "scripts", "check-public-routes.sh")
      .split("\n")
      .map((line) => line.replace(/#.*$/, ""))
      .join("\n");
    // /api/health stayed 200 through a Redis outage that 503'd every page.
    expect(code).toContain("/api/ready");
    expect(code).not.toContain("/api/health");
  });

  it("is what the deploy wrapper runs after a release, and is installed with it", () => {
    const deploy = read("deployment", "scripts", "deploy-vps.sh");
    expect(deploy).toContain(
      "check-public-routes.sh:/usr/local/bin/techclave-check-public-routes",
    );
    expect(deploy).toMatch(/"\$checker" "\$\{bases\[@\]\}"/);
    expect(deploy).toContain("MARKETING_PUBLIC_URL");
  });
});

describe("compose invocations", () => {
  it("load the runtime secrets file on every stack-level compose call", () => {
    // On 2026-09-14 the image-refresh script passed only .env. Compose filled the
    // app's REDIS_URL from .env while Redis read .secrets.env, the passwords
    // disagreed, and every page returned 503.
    const offenders: string[] = [];

    for (const file of shellScripts(DEPLOYMENT)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.replace(/#.*$/, "");
        if (!/\bdocker compose\b/.test(code)) return;
        // Only calls against a deployed stack carry an --env-file at all; the
        // legacy docker-compose.production.yml scripts do not use this layout.
        if (!/--env-file/.test(code)) return;

        // Classify each --env-file argument, in order. Accept either a literal
        // path or the conventional variable names for each file.
        const kinds = [...code.matchAll(/--env-file\s+("[^"]*"|\S+)/g)].map(
          (m) => {
            const arg = m[1];
            if (/\.secrets\.env|SECRETS_FILE/.test(arg)) return "secrets";
            if (/ENV_FILE|\/\.env"?$/.test(arg)) return "env";
            return "other";
          },
        );
        const envAt = kinds.indexOf("env");
        const secretsAt = kinds.indexOf("secrets");
        // Later --env-file wins, so .secrets.env must come after .env.
        if (envAt === -1 || secretsAt === -1 || secretsAt < envAt) {
          offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

describe("shell environment before compose", () => {
  it("never leaves .env's values in the shell without .secrets.env's on top", () => {
    // Compose gives variables in the SHELL priority over every --env-file.
    // A script that exports .env and then calls Compose hands .env's secrets to
    // interpolation even when .secrets.env is passed — the exact way the
    // image-refresh script kept REDIS_PASSWORD stale after it was "fixed".
    const offenders: string[] = [];

    for (const file of shellScripts(DEPLOYMENT)) {
      const code = readFileSync(file, "utf8")
        .split("\n")
        .map((line) => line.replace(/#.*$/, ""))
        .join("\n");
      if (!/\bdocker compose\b/.test(code)) continue;

      const sourcesEnv = code.search(
        /\bsource\s+"?\$\{?(STACK_DIR\}?\/\.env|ENV_FILE)\b/,
      );
      if (sourcesEnv === -1) continue;

      const sourcesSecrets = code.search(
        /\bsource\s+"?\$\{?(STACK_DIR\}?\/\.secrets\.env|SECRETS_FILE)\b/,
      );
      if (sourcesSecrets === -1 || sourcesSecrets < sourcesEnv) {
        offenders.push(relative(ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("VPS artifacts are versioned and wired", () => {
  const units = ["production", "staging"].map((target) => ({
    target,
    service: read(
      "deployment",
      "vps",
      "systemd",
      `booka-${target}-image-refresh.service`,
    ),
    timer: read(
      "deployment",
      "vps",
      "systemd",
      `booka-${target}-image-refresh.timer`,
    ),
  }));

  it("runs the one versioned refresh script for both stacks, under a lock", () => {
    for (const { target, service } of units) {
      expect(service).toContain(
        `/usr/bin/flock -n /run/booka-${target}-image-refresh.lock /usr/local/bin/techclave-refresh-image --remote`,
      );
      expect(service).toContain(`DEPLOY_TARGET=${target}`);
    }
  });

  it("tracks main for production and staging for staging", () => {
    const [prod, staging] = units;
    expect(prod.service).toContain("BRANCH_NAME=main");
    expect(prod.service).toContain("IMAGE_CHANNEL=production");
    expect(prod.service).toContain("STACK_SUBDIR=prod");
    expect(staging.service).toContain("BRANCH_NAME=staging");
    expect(staging.service).toContain("IMAGE_CHANNEL=staging");
    expect(staging.service).toContain("STACK_SUBDIR=staging");
  });

  it("points each timer at its own service", () => {
    for (const { target, timer } of units) {
      expect(timer).toContain(`Unit=booka-${target}-image-refresh.service`);
    }
  });

  it("installs the refresh script alongside the deploy wrapper", () => {
    expect(read("deployment", "scripts", "deploy-vps.sh")).toContain(
      "vps/refresh-image.sh:/usr/local/bin/techclave-refresh-image",
    );
  });

  it("serves every path on techclave.cloud from the app", () => {
    const conf = read("deployment", "nginx", "techclave.cloud.conf");
    const catchAll = /location \/ \{([^}]*)\}/.exec(conf);
    // Without this block only /, /booka and /_next reached the app and every
    // legal page returned nginx 404.
    expect(catchAll).not.toBeNull();
    expect(catchAll![1]).toContain("proxy_pass http://127.0.0.1:3200;");
    expect(conf).toContain("server_name techclave.cloud www.techclave.cloud;");
  });
});
