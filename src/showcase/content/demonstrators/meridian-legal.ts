import { DISCLOSURE } from '../disclosure';
import type { Demonstrator } from '../types';

export const MERIDIAN: Demonstrator = {
  slug: 'meridian-legal', name: 'Meridian Legal', industry: 'Corporate law', projectType: 'Capability Demonstrator',
  oneLineSummary: 'A conservative, typography-led law-firm experience for understanding practice areas and beginning a considered consultation inquiry.',
  businessProblem: 'Prospective clients often encounter firm websites that make it difficult to understand relevant expertise, the first-contact process, and the boundaries of information provided online.',
  targetAudience: 'Business leaders and individuals researching a legal issue before deciding whether to request a consultation.',
  designedOutcome: ['Designed to make practice-area information and consultation next steps easier to assess.', 'Designed to frame online legal information with clear jurisdiction, conflict-check, and no-advice notices.'],
  capabilitiesShown: ['Authority-led information architecture', 'Attorney profile and insight-card patterns', 'Local-only consultation inquiry', 'Prominent legal and conflict-check notices'],
  pages: ['Home', 'Practice areas', 'Team', 'Insights', 'Contact'],
  features: ['Practice-area directory', 'Attorney profiles', 'Insights cards', 'Local consultation form', 'Credentials presentation', 'Jurisdiction and conflict-check notices'],
  stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Local static assets'],
  visualDirection: 'Quiet institutional confidence: restrained navy, parchment, serif typography, sharp edges, and a deliberate editorial rhythm.',
  themeId: 'meridian', disclaimer: DISCLOSURE, status: 'published',
};
