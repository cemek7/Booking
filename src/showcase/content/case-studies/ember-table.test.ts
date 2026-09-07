import { DISCLOSURE } from '../disclosure';
import { EMBER_CASE_STUDY } from './ember-table';

describe('EMBER_CASE_STUDY', () => {
  it('is a truthful capability-demonstrator case study', () => {
    expect(EMBER_CASE_STUDY.projectType).toBe('Capability Demonstrator');
    expect(EMBER_CASE_STUDY.disclosure).toBe(DISCLOSURE);
    expect(EMBER_CASE_STUDY.outcomes.designedImpact.length).toBeGreaterThan(0);
    expect(EMBER_CASE_STUDY.outcomes.limitations.length).toBeGreaterThan(0);
    expect(EMBER_CASE_STUDY).not.toHaveProperty('measuredScores');
  });
});
