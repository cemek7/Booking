import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const baseUrl = process.env.SHOWCASE_BASE_URL ?? 'http://127.0.0.1:3000';
const demos = [
  ['sungrid-energy', 'solutions'], ['northstar-clinic', 'services'], ['ember-table', 'menu'], ['haven-realty', 'properties'],
  ['meridian-legal', 'practice-areas'], ['forge-build', 'services'], ['crestfield-academy', 'admissions'], ['atelier-soso', 'collections'],
];
const desktop = { width: 1440, height: 1000 };
const mobile = { width: 390, height: 844 };
const browser = await chromium.launch();
try {
  for (const [slug, detail] of demos) {
    const dir = `public/mockups/${slug}`;
    await mkdir(dir, { recursive: true });
    const page = await browser.newPage({ viewport: desktop });
    await page.goto(`${baseUrl}/showcase/demos/${slug}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${dir}/desktop-home.png`, fullPage: false });
    await page.goto(`${baseUrl}/showcase/demos/${slug}/${detail}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${dir}/desktop-detail.png`, fullPage: false });
    await page.goto(`${baseUrl}/showcase/demos/${slug}/contact`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${dir}/desktop-form.png`, fullPage: false });
    await page.setViewportSize(mobile);
    await page.goto(`${baseUrl}/showcase/demos/${slug}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${dir}/mobile-home.png`, fullPage: false });
    await page.goto(`${baseUrl}/showcase/demos/${slug}/contact`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${dir}/mobile-form.png`, fullPage: false });
    await page.close();
  }
} finally { await browser.close(); }
