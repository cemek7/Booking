// Canonical content schemas for the TechClave Capability System showcase.
// Shared by every demonstrator record and, later, the case-study and
// capability-deck renderers. Defined once here and re-used everywhere else —
// do not redeclare these shapes elsewhere.

// SiteTheme is owned by the design system (src/showcase/design-system/tokens.ts).
// Re-exported here so content code can depend on `@/showcase/content/types`
// alone without reaching into the design-system module directly.
export type { SiteTheme } from '@/showcase/design-system/tokens';

/** Every demonstrator/case-study in this system is labeled this way — never as commissioned client work. */
export type ProjectType = 'Capability Demonstrator';

export type DemonstratorStatus = 'published' | 'planned';

/**
 * A single industry capability demonstrator (e.g. SunGrid Energy).
 * `status: 'planned'` records are intentionally minimal stubs referenced by
 * the `/showcase/work` grid before that demonstrator is built.
 */
export type Demonstrator = {
  /** URL-safe identifier, e.g. 'sungrid-energy'. */
  slug: string;
  /** Display name, e.g. 'SunGrid Energy'. */
  name: string;
  /** Industry vertical this demonstrator represents, e.g. 'Solar installation'. */
  industry: string;
  /** Always 'Capability Demonstrator' — truthfulness constraint, never commissioned client work. */
  projectType: ProjectType;
  /** One-sentence summary of what this demonstrator shows. */
  oneLineSummary: string;
  /** The (hypothetical) business problem this demonstrator's design addresses. */
  businessProblem: string;
  /** Who the demonstrator's design targets, e.g. 'Homeowners evaluating solar installers'. */
  targetAudience: string;
  /**
   * Expected/designed outcomes, each phrased as a designed goal
   * (e.g. "Designed to reduce quote-request drop-off ..."), never a claimed result.
   */
  designedOutcome: string[];
  /** Capabilities this build is meant to demonstrate (e.g. "Multi-step lead capture forms"). */
  capabilitiesShown: string[];
  /** Page/route names included in the demonstrator. */
  pages: string[];
  /** Notable features implemented. */
  features: string[];
  /** Technology stack used to build it. */
  stack: string[];
  /** Short description of the visual/design direction. */
  visualDirection: string;
  /** Links to the SiteTheme.id used for this demonstrator's chrome. */
  themeId: string;
  /** Required disclosure text — must equal the exported `DISCLOSURE` constant. */
  disclaimer: string;
  status: DemonstratorStatus;
};

/**
 * Outcomes section of a CaseStudy. Only designed/expected impact is allowed —
 * never fabricated measured performance, so this type intentionally has no
 * `measuredScores` (or similar claimed-metrics) field.
 */
export type CaseStudyOutcomes = {
  /** Designed/expected impact, each phrased as a designed goal, never a claimed result. */
  designedImpact: string[];
  /** Honest limitations of the demonstrator (what it deliberately does not do). */
  limitations: string[];
};

/**
 * The canonical case-study record for a demonstrator, rendered by the
 * `/showcase/case-studies/[slug]` website renderer (and, later, the
 * Upwork/LinkedIn/proposal export renderers).
 */
export type CaseStudy = {
  /** URL-safe identifier, matches the related Demonstrator's slug. */
  slug: string;
  /** Display name, e.g. 'SunGrid Energy'. */
  name: string;
  /** Always 'Capability Demonstrator' — truthfulness constraint. */
  projectType: ProjectType;
  /** Required disclosure text — must equal the exported `DISCLOSURE` constant. */
  disclosure: string;
  executiveSummary: string;
  problem: string;
  strategy: string;
  solution: string;
  delivery: string;
  quality: string;
  /** What was actually built/shipped — factual, not a performance claim. */
  deliveredResult: string;
  outcomes: CaseStudyOutcomes;
  capabilitiesShown: string[];
  stack: string[];
  /** Link to the live demonstrator route, if published. */
  demoUrl?: string;
  /** Link to the source repository, if public. */
  repoUrl?: string;
};
