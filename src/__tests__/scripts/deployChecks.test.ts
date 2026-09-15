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

        const envAt = code.search(/--env-file\s+"?[^"\s]*\.env"?(\s|$)/);
        const secretsAt = code.indexOf(".secrets.env");
        if (envAt === -1 || secretsAt === -1 || secretsAt < envAt) {
          offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
