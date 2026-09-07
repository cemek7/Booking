import { DISCLOSURE } from '../disclosure';
import type { Demonstrator } from '../types';

export const EMBER: Demonstrator = {
  slug: 'ember-table',
  name: 'Ember Table',
  industry: 'Premium restaurant',
  projectType: 'Capability Demonstrator',
  oneLineSummary: 'A warm, editorial fine-dining site that presents the menu and story clearly and makes requesting a table feel considered.',
  businessProblem: 'A premium restaurant\'s website often undersells the room and the food, and buries the reservation request behind a generic contact page.',
  targetAudience: 'Diners deciding where to eat for a special occasion or a considered evening out, and researching the menu before they book.',
  designedOutcome: [
    'Designed to reduce friction between browsing the menu or story and requesting a table.',
    'Designed to keep a reservation request within easy reach on every page via a mobile sticky call-to-action.',
  ],
  capabilitiesShown: ['Editorial restaurant design system', 'Menu and private-dining presentation', 'Local-only reservation-request interaction', 'Dietary-information disclosure pattern'],
  pages: ['Home', 'Menu', 'Private Dining', 'About', 'Contact / Reservation'],
  features: ['Menu sections', 'Chef story', 'Vendored gallery imagery', 'Local reservation-request form', 'Private-event call-to-action', 'Location and hours', 'Dietary information note', 'Mobile sticky reservation CTA'],
  stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Local static assets'],
  visualDirection: 'Warm dark editorial: a restrained serif display face, ember-toned accents, and subtle motion over a near-black surface.',
  themeId: 'ember',
  disclaimer: DISCLOSURE,
  status: 'published',
};
