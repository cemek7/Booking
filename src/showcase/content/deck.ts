import { DEMONSTRATORS } from './demonstrators';
export type Slide = { title: string; body: string; kind?: 'cover' | 'section' };
const core: Slide[] = [
  { title: 'Capability systems for considered digital decisions.', body: 'TechClave designs and builds web experiences, product workflows, and integrations that make an important next step clearer.', kind: 'cover' },
  { title: 'Positioning', body: 'A useful digital product connects a real business decision to an understandable customer or operator journey.' },
  { title: 'The recurring problems', body: 'Unclear offers, fragmented information, manual handoffs, and interfaces that ask users to work too hard.' },
  { title: 'What the system covers', body: 'Business websites, conversion flows, web applications, integrations, workflow automation, bounded AI features, and technical audits.' },
  { title: 'Who it serves', body: 'Teams launching a service, rebuilding a customer journey, or turning a costly operational workflow into a reliable product.' },
  { title: 'Method', body: 'Discover the decision, frame the problem, design the journey, build carefully, validate, launch, and improve from evidence.' },
  { title: 'Quality as a delivery habit', body: 'Accessibility, clear content boundaries, responsive behaviour, maintainable implementation, and explicit release checks are part of the work.' },
  { title: 'Technical approach', body: 'Right-sized Next.js and TypeScript systems with reusable content models, local-first demonstrations, and carefully bounded integrations.' },
  { title: 'Engagement shapes', body: 'A focused audit, a defined conversion project, a workflow pilot, or a discovery-to-delivery product engagement—chosen for the problem.' },
  { title: 'Booka: internal product context', body: 'The showcase is intentionally isolated from Booka’s production data layer while demonstrating the design and engineering thinking used alongside it.' },
];
const demoSlides = DEMONSTRATORS.flatMap<Slide>((demo) => [
  { title: demo.name, body: `${demo.industry} · ${demo.projectType}. ${demo.oneLineSummary}`, kind: 'section' },
  { title: `${demo.name}: the problem`, body: demo.businessProblem },
  { title: `${demo.name}: what was built`, body: `Pages: ${demo.pages.join(', ')}. Features: ${demo.features.slice(0, 3).join(', ')}.` },
  { title: `${demo.name}: designed outcome`, body: demo.designedOutcome.join(' ') },
]);
export const DECK: Slide[] = [...core, ...demoSlides, { title: 'Reusable delivery system', body: 'The demonstrators share typed content models, themed components, local-only forms, and disclosure-led case-study records.' }, { title: 'Why TechClave', body: 'The aim is not decorative output: it is a product or website that helps someone understand, decide, and act with less friction.' }, { title: 'Start a conversation', body: 'Bring the website, workflow, or product decision that needs a clearer next step.' }, { title: 'Disclosure', body: 'Every industry example in this deck is a TechClave capability demonstrator and is not presented as commissioned client work.' }];
