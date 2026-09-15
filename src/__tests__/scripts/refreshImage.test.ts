import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { spawnSync } from "child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * deployment/vps/refresh-image.sh is what restarts production after a push. It
 * is run here for real, with docker, git and curl replaced by fakes that record
 * what they were asked to do.
 *
 * Two defects in the version that lived only on the VPS are pinned below:
 *   - It exported .env into the shell before calling Compose. Compose gives
 *     shell variables priority over every --env-file, so .env's REDIS_PASSWORD
 *     beat .secrets.env even with both files passed, and every page 503'd.
 *   - It decided "already deployed" by reading .env, which it rewrites before
 *     the rollout. A failed rollout was never retried.
 */

const SCRIPT = join(process.cwd(), "deployment", "vps", "refresh-image.sh");
const SHA = "a".repeat(40);
const CANDIDATE = `ghcr.io/cemek7/booking:production-${SHA}`;
const OLD_IMAGE = "ghcr.io/cemek7/booking:production-" + "b".repeat(40);

let root: string;
let stack: string;
let bin: string;
let log: string;

function write(path: string, body: string, mode?: number) {
  writeFileSync(path, body);
  if (mode) chmodSync(path, mode);
}

/**
 * Fake docker. State lives in files so separate invocations agree:
 *   running-ref  the image reference the container was created from
 *   running-id   the image id the container is running
 * `compose ... up` "recreates" the container on the pulled image and records
 * the REDIS_PASSWORD the shell handed to Compose.
 */
function installFakes(running: { ref: string; id: string } | null) {
  if (running) {
    write(join(root, "running-ref"), running.ref);
    write(join(root, "running-id"), running.id);
  }

  write(
    join(bin, "docker"),
    `#!/usr/bin/env bash
echo "docker $*" >> "${log}"
state="${root}"
case "$1" in
  inspect)
    [ -f "$state/running-id" ] || exit 1
    case "$*" in
      *Config.Image*) cat "$state/running-ref" ;;
      *.Image*) cat "$state/running-id" ;;
      *) : ;;
    esac ;;
  pull) exit 0 ;;
  manifest) exit 0 ;;
  image)
    case "$*" in
      *.Id*) echo "sha256:new" ;;
      *prune*) exit 0 ;;
    esac ;;
  builder) exit 0 ;;
  compose)
    echo "compose-shell-REDIS_PASSWORD=\${REDIS_PASSWORD:-}" >> "${log}"
    case "$*" in
      *" up "*)
        grep '^APP_IMAGE=' "${stack}/.env" | cut -d= -f2- > "$state/running-ref"
        echo "sha256:new" > "$state/running-id" ;;
    esac ;;
esac
`,
    0o755,
  );

  write(
    join(bin, "git"),
    `#!/usr/bin/env bash\nprintf '%s\\trefs/heads/main\\n' "${SHA}"\n`,
    0o755,
  );
  write(
    join(bin, "curl"),
    `#!/usr/bin/env bash\necho '{"status":"ready"}'\n`,
    0o755,
  );
  write(
    join(bin, "route-checker"),
    `#!/usr/bin/env bash\necho "route-check $*" >> "${log}"\n`,
    0o755,
  );
}

function run() {
  return spawnSync("bash", [SCRIPT, "--remote"], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: root,
      STACK_ROOT: root,
      DEPLOY_TARGET: "production",
      STACK_SUBDIR: "prod",
      CONTAINER_NAME: "booka-prod-app",
      REPO_DIR: join(root, "repo"),
      BRANCH_NAME: "main",
      IMAGE_CHANNEL: "production",
      READY_ATTEMPTS: "2",
      READY_SLEEP_SECONDS: "0",
      ROUTE_CHECKER: join(bin, "route-checker"),
    },
    encoding: "utf8",
  });
}

const logLines = () =>
  existsSync(log) ? readFileSync(log, "utf8").split("\n") : [];
const composeUps = () =>
  logLines().filter((l) => /docker compose .* up /.test(l));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "refresh-image-"));
  stack = join(root, "prod");
  bin = join(root, "bin");
  log = join(root, "calls.log");
  mkdirSync(stack);
  mkdirSync(bin);
  mkdirSync(join(root, "repo", ".git"), { recursive: true });
  write(join(stack, "docker-compose.yml"), "services: {}\n");
  write(join(stack, ".secrets.env"), "REDIS_PASSWORD=from-secrets\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeEnv(appImage: string, extra = "") {
  write(
    join(stack, ".env"),
    `APP_IMAGE=${appImage}\nAPP_PUBLIC_URL=https://app.example.test\n` +
      `REDIS_PASSWORD=stale-from-dotenv\n${extra}`,
  );
}

describe("refresh-image.sh", () => {
  it("hands Compose the .secrets.env value when the two files disagree", () => {
    writeEnv(OLD_IMAGE);
    installFakes({ ref: OLD_IMAGE, id: "sha256:old" });

    const result = run();

    expect(result.status).toBe(0);
    const seen = logLines().filter((l) =>
      l.startsWith("compose-shell-REDIS_PASSWORD="),
    );
    expect(seen.length).toBeGreaterThan(0);
    // Shell variables outrank --env-file in Compose. If the shell held .env's
    // value, the app's REDIS_URL would disagree with Redis.
    for (const line of seen) {
      expect(line).toBe("compose-shell-REDIS_PASSWORD=from-secrets");
    }
  });

  it("deploys a new image when one is published", () => {
    writeEnv(OLD_IMAGE);
    installFakes({ ref: OLD_IMAGE, id: "sha256:old" });

    expect(run().status).toBe(0);
    expect(composeUps()).toHaveLength(1);
    expect(readFileSync(join(stack, ".env"), "utf8")).toContain(
      `APP_IMAGE=${CANDIDATE}`,
    );
  });

  it("retries a rollout that .env claims happened but the container never took", () => {
    // A previous tick rewrote .env and then failed. The old script compared
    // against .env, saw a match, and never deployed again.
    writeEnv(CANDIDATE);
    installFakes({ ref: OLD_IMAGE, id: "sha256:old" });

    expect(run().status).toBe(0);
    expect(composeUps()).toHaveLength(1);
  });

  it("does nothing when the container is already running the published image", () => {
    writeEnv(CANDIDATE);
    installFakes({ ref: CANDIDATE, id: "sha256:new" });

    expect(run().status).toBe(0);
    expect(composeUps()).toHaveLength(0);
  });

  it("checks the public routes on every tick, on every configured host", () => {
    writeEnv(
      CANDIDATE,
      'MARKETING_PUBLIC_URL="https://site.example.test, https://www.site.example.test"\n',
    );
    installFakes({ ref: CANDIDATE, id: "sha256:new" });

    expect(run().status).toBe(0);
    expect(logLines()).toContain(
      "route-check https://app.example.test https://site.example.test https://www.site.example.test",
    );
  });

  it("fails the unit when the route check fails", () => {
    writeEnv(CANDIDATE);
    installFakes({ ref: CANDIDATE, id: "sha256:new" });
    write(join(bin, "route-checker"), "#!/usr/bin/env bash\nexit 1\n", 0o755);

    expect(run().status).not.toBe(0);
  });

  it("refuses to run without the secrets file rather than guessing", () => {
    writeEnv(OLD_IMAGE);
    installFakes({ ref: OLD_IMAGE, id: "sha256:old" });
    rmSync(join(stack, ".secrets.env"));

    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(".secrets.env");
    expect(composeUps()).toHaveLength(0);
  });
});
