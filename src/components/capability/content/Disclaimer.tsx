import { DISCLOSURE } from '@/showcase/content/disclosure';

export type DisclaimerProps = {
  className?: string;
};

/**
 * Renders the required capability-demonstrator disclosure text verbatim.
 * Every showcase page/demo must include this somewhere in its chrome.
 */
export function Disclaimer({ className = '' }: DisclaimerProps) {
  return (
    <p className={`sc-body text-xs opacity-70 ${className}`.trim()} role="note">
      {DISCLOSURE}
    </p>
  );
}
