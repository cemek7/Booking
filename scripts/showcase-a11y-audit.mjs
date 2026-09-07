// Accessibility audit for the /showcase site — a viable Lighthouse alternative.
// Uses axe-core (the same engine behind Lighthouse's accessibility category) via Playwright,
// run against a live server. Emits real, per-route violation counts — no fabricated scores.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';

const base = process.env.SHOWCASE_BASE_URL ?? 'http://127.0.0.1:3000';
const routes = [
  '/showcase', '/showcase/work', '/showcase/services', '/showcase/methodology',
  '/showcase/capabilities', '/showcase/contact',
  '/showcase/demos/sungrid-energy', '/showcase/demos/sungrid-energy/contact',
  '/showcase/demos/northstar-clinic', '/showcase/demos/ember-table',
  '/showcase/demos/haven-realty', '/showcase/demos/haven-realty/properties',
  '/showcase/demos/meridian-legal', '/showcase/demos/forge-build',
  '/showcase/demos/crestfield-academy', '/showcase/demos/atelier-soso',
  '/showcase/case-studies/sungrid-energy', '/showcase/capability-deck',
];

const browser = await chromium.launch();
const context = await browser.newContext();
const rows = [];
let totalCritical = 0, totalSerious = 0, totalViolations = 0;

for (const route of routes) {
  const page = await context.newPage(); // fresh page per route — avoids cross-route state flakiness
  try {
    await page.goto(base + route, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => document.title.length > 0 && document.documentElement.lang.length > 0, { timeout: 5000 }).catch(() => {});
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const critical = results.violations.filter((v) => v.impact === 'critical').length;
    const serious = results.violations.filter((v) => v.impact === 'serious').length;
    totalCritical += critical; totalSerious += serious; totalViolations += results.violations.length;
    const ids = results.violations.map((v) => `${v.id}(${v.impact},${v.nodes.length})`).join(', ') || 'none';
    rows.push(`| \`${route}\` | ${results.violations.length} | ${critical} | ${serious} | ${ids} |`);
  } catch (err) {
    rows.push(`| \`${route}\` | ERROR | - | - | ${err.message.split('\n')[0]} |`);
  } finally {
    await page.close();
  }
}
await browser.close();

const md = `# Accessibility audit (axe-core via Playwright)

Tool: axe-core ${'@axe-core/playwright'} — the same rule engine Lighthouse uses for its accessibility
category — run against a live production server. WCAG 2.0/2.1 A & AA tags. Real measured results, not estimates.

**Totals across ${routes.length} routes:** ${totalViolations} violations (${totalCritical} critical, ${totalSerious} serious).

| Route | Violations | Critical | Serious | Rule ids (impact, nodes) |
| --- | ---: | ---: | ---: | --- |
${rows.join('\n')}

Notes: automated axe checks cover a large share of WCAG success criteria but not all (e.g. meaningful
focus order, sensible reading order, and content quality still need a manual pass). This is an automated
baseline, not a full manual audit.
`;
await writeFile('docs/showcase/ACCESSIBILITY.md', md);
console.log(`a11y audit done: ${totalViolations} violations (${totalCritical} critical, ${totalSerious} serious) across ${routes.length} routes`);
