import { DISCLOSURE } from '../disclosure';
import type { CaseStudy } from '../types';

export const EMBER_CASE_STUDY: CaseStudy = {
  slug: 'ember-table',
  name: 'Ember Table',
  projectType: 'Capability Demonstrator',
  disclosure: DISCLOSURE,
  executiveSummary: 'Ember Table is a capability demonstrator for a premium restaurant that needs its menu, story, and reservation request to feel as considered as the room itself.',
  problem: 'A diner researching a premium restaurant can face a website that undersells the food and the space, with a reservation request buried behind a generic contact page and no consistent way to act on it while browsing.',
  strategy: 'Lead with an editorial visual system that matches a fine-dining room, keep the menu and private-dining information easy to scan, and keep a reservation request within reach on every page rather than only on a contact route.',
  solution: 'A five-route fictional restaurant experience with a menu, private-dining page, chef and space story, vendored gallery imagery, and a privacy-forward local reservation-request interaction with a mobile sticky call-to-action.',
  delivery: 'Built as a static App Router microsite using the capability design system, a scoped Ember theme, and locally vendored, credited stock images. The reservation form has no submission API or storage.',
  quality: 'The demonstrator uses clear content hierarchy, keyboard-operable native controls, a visible dietary-information note, no fabricated reviews, ratings, or awards, and an explicit fictional-demonstrator disclosure.',
  deliveredResult: 'A truthful, navigable restaurant reservation-request demonstrator that shows editorial menu presentation and a persistent conversion path without representing a real venue.',
  outcomes: {
    designedImpact: [
      'Designed to reduce friction between browsing the menu or story and requesting a table.',
      'Designed to keep the reservation request reachable from anywhere on the site via a mobile sticky call-to-action.',
    ],
    limitations: [
      'Illustrative only; it is not a real restaurant and does not represent an actual chef, dish, or venue.',
      'No live table inventory, availability calendar, payment, or form-submission backend is included.',
    ],
  },
  capabilitiesShown: ['Editorial restaurant information architecture', 'Reservation-oriented conversion flow', 'Accessible local form pattern', 'Scoped premium-dining visual system'],
  stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Local static assets'],
  demoUrl: '/showcase/demos/ember-table',
};
