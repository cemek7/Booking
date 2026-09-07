import { DISCLOSURE } from '../disclosure';
import type { CaseStudy } from '../types';

export const HAVEN_CASE_STUDY: CaseStudy = {
  slug: 'haven-realty',
  name: 'Haven Realty',
  projectType: 'Capability Demonstrator',
  disclosure: DISCLOSURE,
  executiveSummary: 'Haven Realty is a capability demonstrator for an estate agency whose buyers need to filter listings quickly, understand affordability, and enquire without friction.',
  problem: 'Buyers on a typical property site struggle to narrow listings by what they actually care about — area, type, and budget — and have no lightweight way to gauge monthly repayments before committing to an enquiry.',
  strategy: 'Present listings as calm, data-forward cards; filter them client-side over a static dataset so browsing feels instant; offer an explicitly illustrative mortgage estimator; and keep both buyer and seller lead paths obvious.',
  solution: 'A five-route fictional agency with a filterable properties page, individual property-detail pages with a gallery, an agent profile, a neighbourhood guide, an illustrative mortgage estimator, and local buyer/seller enquiry forms.',
  delivery: 'Built as a static App Router microsite using the capability design system and a scoped Haven theme. Listings come from a local dataset; the mortgage math is a pure, unit-tested function; forms have no submission backend.',
  quality: 'The demonstrator keeps the estimator clearly labelled illustrative, uses keyboard-operable native controls for filters, vendored and credited imagery, no fabricated sales figures or testimonials, and an explicit fictional-demonstrator disclosure.',
  deliveredResult: 'A truthful, navigable real-estate demonstrator that shows fast client-side filtering, property presentation, and affordability guidance without representing real listings or advice.',
  outcomes: {
    designedImpact: [
      'Designed to help a buyer reach relevant listings faster through instant client-side filtering.',
      'Designed to set expectations on affordability with a clearly illustrative repayment estimate before an enquiry.',
    ],
    limitations: [
      'Illustrative only; listings, prices, and the agency are fictional and do not represent real property.',
      'The mortgage estimate is a simplified model, not financial advice; there is no live listing feed or form backend.',
    ],
  },
  capabilitiesShown: ['Client-side listing filters', 'Property detail and gallery UX', 'Illustrative affordability tooling', 'Buyer/seller lead capture'],
  stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Local static data'],
  demoUrl: '/showcase/demos/haven-realty',
};
