import type { CaseStudy } from '@/showcase/content/types';
export function renderProposal(cs: CaseStudy) { return { problem: cs.problem, relevantDemo: `${cs.name} — ${cs.executiveSummary}`, approach: cs.strategy, proofPoints: cs.capabilitiesShown, cta: `Explore the demonstrator: ${cs.demoUrl ?? 'available on request'}. ${cs.disclosure}` }; }
