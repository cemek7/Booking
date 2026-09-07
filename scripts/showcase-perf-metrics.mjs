// Performance metrics for the /showcase site — a viable Lighthouse alternative for load performance.
// Uses Playwright + the browser Performance API against a live production build. Reports real measured
// signals (First Contentful Paint, DOMContentLoaded, full load, transferred bytes) — NOT a fabricated
// Lighthouse composite score. Run repeatedly / on a deploy target for representative numbers.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const base = process.env.SHOWCASE_BASE_URL ?? 'http://127.0.0.1:3000';
const routes = [
  '/showcase', '/showcase/work',
  '/showcase/demos/sungrid-energy', '/showcase/demos/haven-realty/properties',
  '/showcase/demos/ember-table', '/showcase/demos/atelier-soso',
  '/showcase/capability-deck',
];

const browser = await chromium.launch();
const context = await browser.newContext();
const rows = [];
for (const route of routes) {
  const page = await context.newPage();
  await page.goto(base + route, { waitUntil: 'networkidle', timeout: 30000 });
  // Read timing + transfer sizes from the browser Performance API (resource + navigation entries).
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint');
    const res = performance.getEntriesByType('resource');
    const transferred = (nav?.transferSize || 0) + res.reduce((s, r) => s + (r.transferSize || 0), 0);
    return {
      fcp: paint ? Math.round(paint.startTime) : null,
      dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      load: nav ? Math.round(nav.loadEventEnd) : null,
      kb: Math.round(transferred / 1024),
    };
  });
  rows.push(`| \`${route}\` | ${m.fcp ?? '-'} | ${m.dcl ?? '-'} | ${m.load ?? '-'} |`);
  await page.close();
}
await browser.close();

const md = `# Performance metrics (Playwright + Performance API)

Tool: Playwright driving a headless Chromium against a live production build, reading the browser
Performance API. These are **real measured load signals**, reported instead of a Lighthouse composite
score — no score is fabricated. Numbers vary by host/network; capture on your deploy target for
representative figures.

| Route | FCP (ms) | DOMContentLoaded (ms) | Load (ms) |
| --- | ---: | ---: | ---: |
${rows.join('\n')}

Notes: measured on the local production server; timings are low because there is no network latency
locally — capture on the deploy target for representative numbers. Transfer size is omitted because
headless Chromium reports \`transferSize\` as 0 for these responses; measure payload with the deploy
host's tooling. For a full Lighthouse-style composite (SEO/best-practices/PWA), run Lighthouse against
the deployed URL; this script covers the load-timing signals without it.
`;
await writeFile('docs/showcase/PERFORMANCE.md', md);
console.log('perf metrics written for', routes.length, 'routes');
