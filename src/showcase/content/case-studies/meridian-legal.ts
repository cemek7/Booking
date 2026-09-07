import { DISCLOSURE } from '../disclosure';
import type { CaseStudy } from '../types';

export const MERIDIAN_CASE_STUDY: CaseStudy = {
  slug: 'meridian-legal', name: 'Meridian Legal', projectType: 'Capability Demonstrator', disclosure: DISCLOSURE,
  executiveSummary: 'Meridian Legal is a capability demonstrator for a corporate-law firm that needs to communicate areas of focus and offer a carefully bounded consultation path.',
  problem: 'Legal services information must establish clarity and confidence while avoiding online advice, unsupported outcome claims, and an implied attorney-client relationship.',
  strategy: 'Use an editorial hierarchy for practice information, make legal boundaries visible at every decision point, and make the consultation path simple without presenting it as engagement.',
  solution: 'A five-route fictional firm site with practice-area cards, illustrative attorney profiles, insights, credentials, and a local-only consultation inquiry form with jurisdiction and conflict-check guidance.',
  delivery: 'Built as a static App Router demonstrator using the scoped capability design system, a Meridian theme, and vendored, credited stock imagery. The form has no transmission or storage path.',
  quality: 'The experience identifies itself as a capability demonstrator, avoids legal advice and case-result claims, labels illustrative content clearly, and places the no-relationship and conflict-check notices beside contact actions.',
  deliveredResult: 'A truthful law-firm demonstrator that shows a clear authority-led content system and bounded consultation inquiry flow.',
  outcomes: { designedImpact: ['Designed to help a prospective client locate a relevant practice area before making contact.', 'Designed to make the limits of online information clear before an inquiry begins.'], limitations: ['Illustrative only; Meridian Legal and its profiles are fictional.', 'No legal advice, conflict check, attorney-client relationship, or live inquiry handling is provided.'] },
  capabilitiesShown: ['Practice-area information architecture', 'Editorial insight cards', 'Compliance-aware conversion copy', 'Local-only lead capture'], stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Local static assets'], demoUrl: '/showcase/demos/meridian-legal',
};
