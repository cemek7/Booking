import { expect, describe, it } from '@jest/globals';
import { MERIDIAN_CASE_STUDY } from './meridian-legal';
describe('MERIDIAN_CASE_STUDY', () => {
  it('is truthful and complete', () => {
    expect(MERIDIAN_CASE_STUDY.projectType).toBe('Capability Demonstrator');
    expect(MERIDIAN_CASE_STUDY.disclosure.toLowerCase()).toContain('not presented as commissioned client work');
    expect(MERIDIAN_CASE_STUDY.outcomes.designedImpact.length).toBeGreaterThan(0);
    expect(MERIDIAN_CASE_STUDY.outcomes.limitations.length).toBeGreaterThan(0);
    expect(MERIDIAN_CASE_STUDY).not.toHaveProperty('measuredScores');
  });
});
