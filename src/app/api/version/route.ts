export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

/**
 * Lightweight, public build-identity endpoint.
 *
 * Reports the git commit the running image was built from, so a promotion can
 * be positively verified (compare `commit` against the merged SHA) rather than
 * inferred from `/api/health` being up. GIT_SHA is injected at image build time
 * (Dockerfile.vps ARG -> ENV, passed as --build-arg GIT_SHA=${{ github.sha }}
 * by deploy-vps.yml); it is `unknown` for local/dev runs where no build arg was
 * supplied. No secrets are exposed.
 */
export async function GET() {
  const commit = process.env.GIT_SHA || 'unknown';
  return NextResponse.json(
    {
      version: process.env.APP_VERSION || '1.0.0',
      commit,
      shortCommit: commit === 'unknown' ? 'unknown' : commit.slice(0, 8),
      buildTime: process.env.BUILD_TIME || null,
      nodeEnv: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
