import { describe, it, expect } from '@jest/globals';
import { DEMONSTRATORS } from './demonstrators';
import { DISCLOSURE } from './disclosure';

describe('demonstrator content', () => {
  it('lists exactly 8 demonstrators, all labeled Capability Demonstrator', () => {
    expect(DEMONSTRATORS).toHaveLength(8);
    for (const d of DEMONSTRATORS) expect(d.projectType).toBe('Capability Demonstrator');
  });
  it('has SunGrid published and the rest planned', () => {
    const sg = DEMONSTRATORS.find((d) => d.slug === 'sungrid-energy')!;
    expect(sg.status).toBe('published');
    expect(DEMONSTRATORS.filter((d) => d.status === 'planned')).toHaveLength(7);
  });
  it('carries the required disclosure text', () => {
    expect(DISCLOSURE).toMatch(/capability demonstrator/i);
    expect(DISCLOSURE).toMatch(/not presented as commissioned client work/i);
  });
});
