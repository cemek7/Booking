import type { Demonstrator } from '../types';
import { DISCLOSURE } from '../disclosure';

/**
 * SunGrid Energy — the Session-1 published capability demonstrator.
 * A solar-installation marketing/lead-gen site: real authored prose, no
 * fabricated users, revenue, testimonials, traffic, or performance metrics.
 * Every "designedOutcome" entry is a designed/expected goal, not a claimed result.
 */
export const SUNGRID: Demonstrator = {
  slug: 'sungrid-energy',
  name: 'SunGrid Energy',
  industry: 'Solar installation',
  projectType: 'Capability Demonstrator',
  oneLineSummary:
    'A residential and commercial solar-installer site built to show how a technical, credible, conversion-oriented energy brand could look, explain its offer, and capture qualified leads.',
  businessProblem:
    'Solar installers typically sell a large, unfamiliar purchase to buyers who are unsure whether solar is worth it for their property, skeptical of savings claims, and uncertain how financing and installation actually work. A marketing site for this industry has to build technical credibility, make the value proposition concrete without over-promising numbers it cannot back up, and give visitors a low-friction way to request a site assessment instead of asking them to buy immediately.',
  targetAudience:
    'Homeowners and small/medium commercial property owners evaluating whether to request a solar site assessment, comparing installers, and looking for a clear breakdown of process, financing options, and realistic expectations before committing.',
  designedOutcome: [
    'Designed to reduce drop-off between "interested in solar" and "requested an assessment" by shortening the path to the lead form and keeping the ask small (a site assessment, not a purchase).',
    'Designed to build technical credibility through a clear, honest process explanation (assessment → design → permitting → install → commissioning) rather than generic marketing claims.',
    'Designed to let visitors self-segment into residential or commercial paths early, so the content and CTA they see match their situation.',
    'Designed to set honest expectations on savings by labeling every estimate as illustrative and showing the assumptions behind it, rather than presenting a single unqualified number.',
    'Designed to make the financing conversation approachable by surfacing financing-style options as informational content rather than a hidden detail found only after contact.',
  ],
  capabilitiesShown: [
    'Multi-page, theme-driven site build with a distinct scoped visual identity (dark technical palette, solar-gold accent)',
    'Audience-segmented navigation and page structure (residential vs. commercial)',
    'Local-mock, validated lead-capture form (no backend, no network calls)',
    'Deterministic, clearly-labeled illustrative estimator tool with stated assumptions',
    'Content-driven projects gallery using properly sourced, downloaded, credited images',
    'Structured process/timeline presentation',
    'Per-route SEO metadata and an accessible, reduced-motion-aware, responsive layout',
  ],
  pages: ['Home', 'Solutions', 'Savings', 'Projects', 'Process', 'Contact'],
  features: [
    'Residential and commercial solution paths',
    'Site-assessment request form (local mock submission, no network)',
    'Illustrative savings estimator, clearly labeled and assumption-transparent',
    'Projects gallery (sourced, downloaded, credited royalty-free images)',
    'Financing-information placeholder content',
    'Process timeline (assessment through commissioning)',
    'FAQ section',
    'Service-area summary',
    'Per-route SEO metadata',
    'Required capability-demonstrator disclosure banner on every page',
  ],
  stack: ['Next.js 16 (App Router)', 'React 19', 'TypeScript (strict)', 'Tailwind CSS', 'Scoped CSS-custom-property theming'],
  visualDirection:
    'Technical, credible, bright and modern: a deep navy/teal base with a solar-gold primary accent, strong data presentation (numbers, timelines, comparisons), and a display/body font pairing (Space Grotesk / Inter) chosen for a precise, engineered feel rather than a soft consumer-lifestyle look.',
  themeId: 'sungrid',
  disclaimer: DISCLOSURE,
  status: 'published',
};
