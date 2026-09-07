import { DISCLOSURE } from '../disclosure';
import type { Demonstrator } from '../types';

export const NORTHSTAR: Demonstrator = {
  slug: 'northstar-clinic',
  name: 'Northstar Clinic',
  industry: 'Private healthcare',
  projectType: 'Capability Demonstrator',
  oneLineSummary: 'A calm, accessible private-clinic experience that helps prospective patients understand services and request a non-emergency appointment.',
  businessProblem: 'Clinic information, provider context, and appointment requests are often scattered, making a routine first contact feel unnecessarily uncertain.',
  targetAudience: 'Prospective patients looking for clear service information and a straightforward way to request a routine appointment.',
  designedOutcome: [
    'Designed to reduce friction between finding the right service and starting an appointment request.',
    'Designed to make practical information—hours, location, payment, and non-emergency guidance—easy to find before a patient contacts the clinic.',
  ],
  capabilitiesShown: ['Trust-building information architecture', 'Accessible service and clinician directory', 'Local-only appointment-request interaction', 'Healthcare-safe conversion copy and emergency notice'],
  pages: ['Home', 'Services', 'Doctors', 'Patient information', 'Contact'],
  features: ['Service directory', 'Clinician profiles', 'Local appointment-request form', 'Insurance and payment guidance', 'FAQ', 'Locations and hours', 'Emergency disclaimer'],
  stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Local static assets'],
  visualDirection: 'Calm clinical clarity: generous white space, reassuring blue and teal accents, and an editorial hierarchy focused on legibility.',
  themeId: 'northstar',
  disclaimer: DISCLOSURE,
  status: 'published',
};
