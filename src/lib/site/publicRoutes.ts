/**
 * Pages a visitor must be able to reach by clicking.
 *
 * Single source for two checks that guard different failures:
 *   - src/__tests__/site/publicSurface.test.ts fails the build when one of these
 *     has no link pointing at it.
 *   - deployment/scripts/check-public-routes.sh fails a release when one of them
 *     does not return 2xx/3xx on the live host — which is how techclave.cloud
 *     serving nginx 404s for every legal page was finally caught.
 *
 * The shell script carries its own copy of this list; a test keeps them equal.
 */
export const PUBLIC_ROUTES: readonly string[] = [
  "/",
  "/contact",
  "/products",
  "/showcase",
  "/booka",
  "/privacy",
  "/terms",
  "/cookies",
  "/refunds",
  "/acceptable-use",
  "/accessibility",
  "/data-retention",
  "/dpa",
  "/sub-processors",
  "/ugc-policy",
];
