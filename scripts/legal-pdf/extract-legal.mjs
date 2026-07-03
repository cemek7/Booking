import fs from 'fs';
const ROOT = '/home/ccemeka/Techclave/Booking/Booking';

// --- parse LEGAL constants ---
const csrc = fs.readFileSync(`${ROOT}/src/lib/legal/constants.ts`, 'utf8');
const LEGAL = {};
for (const m of csrc.matchAll(/(\w+):\s*'([^']*)'/g)) LEGAL[m[1]] = m[2];
// sub-processors
const SUBS = [];
const subBlock = csrc.slice(csrc.indexOf('SUB_PROCESSORS'));
for (const m of subBlock.matchAll(/name:\s*'([^']*)',\s*purpose:\s*'([^']*)',\s*region:\s*'([^']*)'/g))
  SUBS.push({ name: m[1], purpose: m[2], region: m[3] });

function resolve(s) {
  return s
    .replace(/\{LEGAL\.(\w+)\}/g, (_, k) => LEGAL[k] ?? `[${k}]`)
    .replace(/\{'\s*'\}/g, ' ')
    .replace(/&apos;|&#039;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/<(strong|em|span)[^>]*>/g, '').replace(/<\/(strong|em|span)>/g, '')
    .replace(/<(?:Link|a)[^>]*>(.*?)<\/(?:Link|a)>/gs, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ').trim();
}

function extractPage(file, title) {
  const src = fs.readFileSync(`${ROOT}/${file}`, 'utf8');
  const sections = [];
  const secRe = /<LegalSection\s+heading="([^"]+)"[^>]*>([\s\S]*?)<\/LegalSection>/g;
  let m;
  while ((m = secRe.exec(src))) {
    const heading = resolve(m[1]);
    const inner = m[2];
    const blocks = [];
    // special: sub-processors table
    if (/SUB_PROCESSORS\.map/.test(inner)) {
      for (const s of SUBS) blocks.push({ type: 'li', text: `${s.name} — ${s.purpose} (${s.region})` });
    }
    // paragraphs
    for (const p of inner.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
      const t = resolve(p[1]); if (t) blocks.push({ type: 'p', text: t });
    }
    // list items
    for (const li of inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
      const t = resolve(li[1]); if (t) blocks.push({ type: 'li', text: t });
    }
    sections.push({ heading, blocks });
  }
  return { title, sections };
}

const PAGES = [
  ['src/app/privacy/page.tsx', 'Privacy Policy'],
  ['src/app/terms/page.tsx', 'Terms of Service'],
  ['src/app/cookies/page.tsx', 'Cookie Policy'],
  ['src/app/refunds/page.tsx', 'Refunds & Cancellations'],
  ['src/app/acceptable-use/page.tsx', 'Acceptable Use Policy'],
  ['src/app/ugc-policy/page.tsx', 'User-Generated Content Policy'],
  ['src/app/dpa/page.tsx', 'Data Processing Agreement (DPA)'],
  ['src/app/sub-processors/page.tsx', 'Sub-processors'],
  ['src/app/accessibility/page.tsx', 'Accessibility Statement'],
  ['src/app/data-retention/page.tsx', 'Data Retention Schedule'],
];
const out = { legal: LEGAL, docs: PAGES.map(([f, t]) => extractPage(f, t)) };
fs.writeFileSync('/tmp/legal.json', JSON.stringify(out, null, 2));
console.log('LEGAL:', LEGAL.company, LEGAL.product, LEGAL.lastUpdated, '| subs:', SUBS.length, '| docs:', out.docs.length);
console.log('sample (privacy §1):', out.docs[0].sections[0].heading, '=>', out.docs[0].sections[0].blocks[0]?.text.slice(0, 90));
