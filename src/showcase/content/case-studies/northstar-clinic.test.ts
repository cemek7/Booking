import { DISCLOSURE } from '../disclosure';
import { NORTHSTAR_CASE_STUDY } from './northstar-clinic';

describe('NORTHSTAR_CASE_STUDY', () => {
  it('is a truthful capability-demonstrator case study', () => {
    expect(NORTHSTAR_CASE_STUDY.projectType).toBe('Capability Demonstrator');
    expect(NORTHSTAR_CASE_STUDY.disclosure).toBe(DISCLOSURE);
    expect(NORTHSTAR_CASE_STUDY.outcomes.designedImpact.length).toBeGreaterThan(0);
    expect(NORTHSTAR_CASE_STUDY.outcomes.limitations.length).toBeGreaterThan(0);
    expect(NORTHSTAR_CASE_STUDY).not.toHaveProperty('measuredScores');
  });
});
