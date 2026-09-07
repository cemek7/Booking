import { DISCLOSURE } from '../disclosure';
import type { CaseStudy } from '../types';

export const NORTHSTAR_CASE_STUDY: CaseStudy = {
  slug: 'northstar-clinic',
  name: 'Northstar Clinic',
  projectType: 'Capability Demonstrator',
  disclosure: DISCLOSURE,
  executiveSummary: 'Northstar Clinic is a capability demonstrator for a private healthcare provider that needs to make routine care information and an appointment request feel clear, calm, and responsible.',
  problem: 'A prospective patient can face a fragmented journey: unclear service descriptions, little context about clinicians, and a generic contact route that does not set expectations for routine versus emergency care.',
  strategy: 'Prioritise patient questions before conversion, use plain-language service and clinician context, and make routine-care boundaries and emergency guidance visible wherever contact is invited.',
  solution: 'A five-route fictional clinic experience with service and clinician directories, patient-information content, FAQs, location and hours, and a privacy-forward local appointment-request interaction.',
  delivery: 'Built as a static App Router microsite using the capability design system, a scoped Northstar theme, and locally vendored, credited stock images. The appointment form has no submission API or storage.',
  quality: 'The demonstrator uses clear content hierarchy, keyboard-operable native controls, visible non-emergency guidance, no medical outcome claims, and an explicit fictional-demonstrator disclosure.',
  deliveredResult: 'A truthful, navigable clinic appointment-request demonstrator that shows trust-building information architecture without representing a real provider or live care service.',
  outcomes: {
    designedImpact: [
      'Designed to reduce friction between identifying a routine service and starting an appointment request.',
      'Designed to make payment, location, privacy, and emergency boundaries clear before a patient submits a request.',
    ],
    limitations: [
      'Illustrative only; it is not a real clinic and provides no medical advice, diagnosis, treatment, or emergency service.',
      'No live scheduling, patient record, payment, insurance verification, or form-submission backend is included.',
    ],
  },
  capabilitiesShown: ['Healthcare-safe information architecture', 'Trust-oriented conversion flow', 'Accessible local form pattern', 'Scoped healthcare visual system'],
  stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Local static assets'],
  demoUrl: '/showcase/demos/northstar-clinic',
};
