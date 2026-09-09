import { describe, it, expect } from '@jest/globals';
import { matchSpecialtiesToServices } from '@/lib/whatsapp/v2/flows/ownerOnboarding';

/**
 * The owner types "Adaeze does braids and twists" in chat. Both halves used to
 * be discarded — the staff row was written with no name, and the specialties
 * only flipped services_all to false without ever reaching staff_services. The
 * booking engine reads staff_services to decide who can do what, so the result
 * was named staff who could perform nothing.
 */

const SERVICES = [
  { id: 's-braids', name: 'Box Braids' },
  { id: 's-twists', name: 'Twists' },
  { id: 's-frontal', name: 'Frontal Install' },
];

describe('matchSpecialtiesToServices', () => {
  it('matches a specialty that is a substring of the service name', () => {
    // Owners set up "Box Braids" then say someone "does braids".
    expect(matchSpecialtiesToServices(['braids'], SERVICES)).toEqual(['s-braids']);
  });

  it('matches a specialty that CONTAINS the service name', () => {
    expect(matchSpecialtiesToServices(['frontal install and styling'], SERVICES))
      .toEqual(['s-frontal']);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(matchSpecialtiesToServices(['  TWISTS '], SERVICES)).toEqual(['s-twists']);
  });

  it('matches several specialties at once, without duplicates', () => {
    const out = matchSpecialtiesToServices(['braids', 'twists', 'braids'], SERVICES);
    expect(out.sort()).toEqual(['s-braids', 's-twists']);
  });

  it('returns nothing for a specialty that matches no service', () => {
    // The caller reads an empty result as "no specialty named", which widens
    // the staff member to services_all rather than leaving them unbookable.
    expect(matchSpecialtiesToServices(['massage'], SERVICES)).toEqual([]);
  });

  it('returns nothing when no specialties were given', () => {
    expect(matchSpecialtiesToServices(undefined, SERVICES)).toEqual([]);
    expect(matchSpecialtiesToServices([], SERVICES)).toEqual([]);
  });

  it('skips blank entries rather than matching everything', () => {
    // An empty needle is a substring of every name; without the guard one
    // stray comma would assign a staff member to the entire menu.
    expect(matchSpecialtiesToServices(['', '   '], SERVICES)).toEqual([]);
  });

  it('copes with a tenant that has no services yet', () => {
    expect(matchSpecialtiesToServices(['braids'], [])).toEqual([]);
  });
});
