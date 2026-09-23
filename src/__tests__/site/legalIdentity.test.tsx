import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import PrivacyPage from '@/app/privacy/page';
import TermsPage from '@/app/terms/page';
import DpaPage from '@/app/dpa/page';
import { LEGAL } from '@/lib/legal/constants';

const VERIFIED_ENTITY = 'Techclave Ltd';
const VERIFIED_REGISTRATION = 'RC 8489929';
const VERIFIED_ADDRESS = '25, Ndola Crescent, Wuse Zone 5, FCT, Nigeria';

describe('public legal identity', () => {
  it('uses the verified CAC identity instead of a launch placeholder', () => {
    expect(LEGAL).toMatchObject({
      entity: VERIFIED_ENTITY,
      registrationNumber: VERIFIED_REGISTRATION,
      registeredAddress: VERIFIED_ADDRESS,
    });
    expect(JSON.stringify(LEGAL)).not.toMatch(/to be confirmed/i);
  });

  it.each([
    ['Privacy Policy', PrivacyPage],
    ['Terms of Service', TermsPage],
    ['Data Processing Agreement', DpaPage],
  ])('%s identifies the registered operator', (_name, Page) => {
    const { unmount } = render(<Page />);

    expect(screen.getAllByText(new RegExp(VERIFIED_ENTITY, 'i')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(VERIFIED_REGISTRATION, 'i')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp('25, Ndola Crescent', 'i')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/legal entity to be confirmed/i)).not.toBeInTheDocument();

    unmount();
  });
});
