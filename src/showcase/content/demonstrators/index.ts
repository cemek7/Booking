import type { Demonstrator } from '../types';
import { DISCLOSURE } from '../disclosure';
import { SUNGRID } from './sungrid-energy';
import { NORTHSTAR } from './northstar-clinic';

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
  plannedStub({
    slug: 'ember-table',
    name: 'Ember Table',
    industry: 'Restaurant reservations & dining',
    oneLineSummary: 'Planned demonstrator: a full-service restaurant site with reservations and menu presentation.',
    targetAudience: 'Diners deciding where to eat and booking a table.',
  }),
  plannedStub({
    slug: 'meridian-legal',
    name: 'Meridian Legal',
    industry: 'Legal services',
    oneLineSummary: 'Planned demonstrator: a law-firm site built around practice areas and consultation requests.',
    targetAudience: 'Prospective clients researching a legal issue and evaluating firms.',
  }),
  plannedStub({
    slug: 'forge-build',
    name: 'Forge Build',
    industry: 'Construction & contracting',
    oneLineSummary: 'Planned demonstrator: a general-contracting site with project showcase and quote requests.',
    targetAudience: 'Property owners planning a construction or renovation project.',
  }),
  plannedStub({
    slug: 'haven-realty',
    name: 'Haven Realty',
    industry: 'Residential real estate',
    oneLineSummary: 'Planned demonstrator: a real-estate agency site with listings and buyer/seller inquiry flows.',
    targetAudience: 'Home buyers and sellers evaluating an agency to work with.',
  }),
  plannedStub({
    slug: 'crestfield-academy',
    name: 'Crestfield Academy',
    industry: 'Private school / academy',
    oneLineSummary: 'Planned demonstrator: a private school site covering admissions and program information.',
    targetAudience: 'Parents researching schools and starting the admissions process.',
  }),
  plannedStub({
    slug: 'atelier-soso',
    name: 'Atelier Soso',
    industry: 'Fashion & beauty studio',
    oneLineSummary: 'Planned demonstrator: a fashion/beauty studio site with services and booking inquiries.',
    targetAudience: 'Clients researching a studio and its services before booking.',
  }),
];
