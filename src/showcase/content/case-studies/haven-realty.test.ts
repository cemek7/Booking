import { HAVEN_CASE_STUDY } from './haven-realty';

describe('HAVEN_CASE_STUDY', () => {
  it('is labelled a Capability Demonstrator and carries the disclosure', () => {
    expect(HAVEN_CASE_STUDY.projectType).toBe('Capability Demonstrator');
    expect(HAVEN_CASE_STUDY.disclosure.toLowerCase()).toContain('not presented as commissioned client work');
  });
  it('has designed impact and limitations, and no fabricated measured scores', () => {
    expect(HAVEN_CASE_STUDY.outcomes.designedImpact.length).toBeGreaterThan(0);
    expect(HAVEN_CASE_STUDY.outcomes.limitations.length).toBeGreaterThan(0);
    expect(HAVEN_CASE_STUDY).not.toHaveProperty('measuredScores');
  });
});
