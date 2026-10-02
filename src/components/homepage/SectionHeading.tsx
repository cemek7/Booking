import type { ReactNode } from 'react';

type SectionHeadingProps = {
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  as?: 'h1' | 'h2';
  tone?: 'light' | 'dark';
  className?: string;
};

export default function SectionHeading({
  kicker,
  title,
  lede,
  as: Heading = 'h2',
  tone = 'light',
  className = '',
}: SectionHeadingProps) {
  const dark = tone === 'dark';
  const size =
    Heading === 'h1' ? 'text-4xl sm:text-5xl lg:text-6xl' : 'text-3xl sm:text-4xl';

  return (
    <div className={className}>
      <p className={`brand-kicker ${dark ? 'text-[var(--brand-gold)]' : 'text-[var(--brand-moss)]'}`}>
        {kicker}
      </p>
      <Heading
        className={`techclave-display mt-4 max-w-4xl text-balance ${size} ${
          dark ? 'text-[var(--brand-paper)]' : 'text-[var(--brand-ink)]'
        }`}
      >
        {title}
      </Heading>
      {lede ? (
        <p
          className={`mt-5 max-w-[60ch] text-pretty text-lg leading-8 ${
            dark ? 'text-[#d7ddd9]' : 'text-[#4f5d59]'
          }`}
        >
          {lede}
        </p>
      ) : null}
    </div>
  );
}
