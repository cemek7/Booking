import { expect, describe, it } from '@jest/globals';
import { FORGE_CASE_STUDY } from './forge-build';
describe('FORGE_CASE_STUDY', () => { it('is truthful and complete', () => { expect(FORGE_CASE_STUDY.projectType).toBe('Capability Demonstrator'); expect(FORGE_CASE_STUDY.disclosure).toContain('not presented as commissioned client work'); expect(FORGE_CASE_STUDY.outcomes.designedImpact.length).toBeGreaterThan(0); expect(FORGE_CASE_STUDY.outcomes.limitations.length).toBeGreaterThan(0); expect(FORGE_CASE_STUDY).not.toHaveProperty('measuredScores'); }); });
