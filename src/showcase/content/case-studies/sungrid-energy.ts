import type { CaseStudy } from '../types';
import { DISCLOSURE } from '../disclosure';

export const SUNGRID_CASE_STUDY: CaseStudy = {
  slug: 'sungrid-energy', name: 'SunGrid Energy', projectType: 'Capability Demonstrator', disclosure: DISCLOSURE,
  executiveSummary: 'SunGrid Energy is a capability demonstrator for a solar installer that needs to turn a complex, high-consideration purchase into an understandable site-assessment journey.',
  problem: 'Prospective buyers need technical clarity without being pushed into an unqualified savings or installation promise.',
  strategy: 'Use audience-specific paths, short decision-support content, transparent assumptions, and a small assessment ask instead of a generic quote funnel.',
  solution: 'A six-route demonstrator with residential and commercial paths, an assumption-transparent illustrative estimator, planning studies, process explanation, and a local-only assessment form.',
  delivery: 'Built as a static App Router microsite using scoped CSS variables and reusable capability components. It has no data store, authentication, tracking, or submission API.',
  quality: 'The route system is keyboard-operable, reduced-motion aware, typechecked, linted, and isolated from Booka product and data-layer imports.',
  deliveredResult: 'A truthful, navigable solar lead-generation demonstrator with local-only interactions and required disclosure.',
  outcomes: { designedImpact: ['Designed to reduce friction between initial curiosity and a site-assessment request.', 'Designed to make solar assumptions visible before a visitor is asked to contact a provider.'], limitations: ['Illustrative only; it is not commissioned client work.', 'No live assessment booking, pricing engine, monitoring feed, or performance guarantee is included.'] },
  capabilitiesShown: ['Scoped themed multi-page site', 'Conversion-form design', 'Illustrative calculator UX', 'Accessible content hierarchy'], stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS'], demoUrl: '/showcase/demos/sungrid-energy',
};
