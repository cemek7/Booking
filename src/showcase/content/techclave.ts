// Corporate-level content for the TechClave capability showcase itself
// (as opposed to any individual demonstrator). Consumed by later sessions'
// corporate pages (services/methodology/capabilities/contact). Kept honest:
// no fabricated client counts, revenue, or testimonials — see
// docs/superpowers/specs/2026-07-30-techclave-capability-system-showcase-design.md §2.

export type TechClaveProfile = {
  name: string;
  tagline: string;
  description: string;
  /** What this showcase demonstrates the ability to build, not what has been sold. */
  capabilities: string[];
  disclosureNote: string;
};

import { DISCLOSURE } from './disclosure';

export const TECHCLAVE: TechClaveProfile = {
  name: 'TechClave',
  tagline: 'Design, development, and conversion systems — demonstrated, not just described.',
  description:
    'TechClave builds capability demonstrators: complete, industry-specific web experiences that show how a real product for that industry could be designed, built, and structured to convert. Each demonstrator is a self-contained showcase of process and craft, not a commissioned client project.',
  capabilities: [
    'Responsive, accessible, theme-driven front-end builds',
    'Conversion-focused page structure (hero, trust signals, process, CTA)',
    'Local-mock lead capture and form validation flows',
    'Illustrative, clearly-labeled estimator/calculator tooling',
    'Canonical, reusable content and case-study schemas across many industries',
  ],
  disclosureNote: DISCLOSURE,
};
