import { DISCLOSURE } from '../disclosure';
import type { Demonstrator } from '../types';

export const HAVEN: Demonstrator = {
  slug: 'haven-realty',
  name: 'Haven Realty',
  industry: 'Real estate',
  projectType: 'Capability Demonstrator',
  oneLineSummary: 'A polished property-listing site that makes browsing, filtering, and enquiring about homes feel effortless — with an illustrative mortgage estimator.',
  businessProblem: 'A real-estate site often makes listings hard to filter, hides the agent behind a form, and gives buyers no way to sanity-check affordability before they enquire.',
  targetAudience: 'Buyers browsing homes by area and budget, and sellers looking for a straightforward way to request a valuation.',
  designedOutcome: [
    'Designed to help a buyer narrow listings by area, type, and budget without a page reload.',
    'Designed to let a buyer gauge illustrative monthly repayments before starting an enquiry.',
  ],
  capabilitiesShown: ['Client-side listing filters over static data', 'Property detail and gallery presentation', 'Illustrative mortgage estimator', 'Buyer and seller lead capture'],
  pages: ['Home', 'Properties', 'Property Detail', 'Sell With Us', 'Contact'],
  features: ['Client-side property filters', 'Property cards and detail pages', 'Vendored gallery imagery', 'Agent profile', 'Illustrative mortgage estimator', 'Local inquiry form', 'Neighbourhood guide'],
  stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Local static data'],
  visualDirection: 'Clean editorial luxury: a refined serif display face, warm gold accents, generous spacing, and calm data-forward listing cards.',
  themeId: 'haven',
  disclaimer: DISCLOSURE,
  status: 'published',
};
