import type { Demonstrator } from '../types';
import { DISCLOSURE } from '../disclosure';
import { SUNGRID } from './sungrid-energy';
import { NORTHSTAR } from './northstar-clinic';
import { EMBER } from './ember-table';
import { HAVEN } from './haven-realty';
import { MERIDIAN } from './meridian-legal';
import { FORGE } from './forge-build';
import { CRESTFIELD } from './crestfield-academy';

/**
 * Minimal, honest stub for a demonstrator that has not been built yet.
 * No pages/features/capabilities are listed because none exist yet —
 * listing them would misrepresent what has actually been built.
 */
function plannedStub(input: {
  slug: string;
  name: string;
  industry: string;
  oneLineSummary: string;
  targetAudience: string;
}): Demonstrator {
  return {
    slug: input.slug,
    name: input.name,
    industry: input.industry,
    projectType: 'Capability Demonstrator',
    oneLineSummary: input.oneLineSummary,
    businessProblem: 'Not yet authored — this demonstrator is planned but not yet built.',
    targetAudience: input.targetAudience,
    designedOutcome: ['Designed outcomes will be defined when this demonstrator is built.'],
    capabilitiesShown: [],
    pages: [],
    features: [],
    stack: [],
    visualDirection: 'Not yet defined.',
    themeId: input.slug,
    disclaimer: DISCLOSURE,
    status: 'planned',
  };
}

export const DEMONSTRATORS: Demonstrator[] = [
  SUNGRID,
  NORTHSTAR,
  EMBER,
  MERIDIAN,
  FORGE,
  HAVEN,
  CRESTFIELD,
  plannedStub({
    slug: 'atelier-soso',
    name: 'Atelier Soso',
    industry: 'Fashion & beauty studio',
    oneLineSummary: 'Planned demonstrator: a fashion/beauty studio site with services and booking inquiries.',
    targetAudience: 'Clients researching a studio and its services before booking.',
  }),
];
