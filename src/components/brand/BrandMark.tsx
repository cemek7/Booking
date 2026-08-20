import Image from 'next/image';

type BrandMarkProps = {
  variant?: 'techclave' | 'booka';
  className?: string;
};

export default function BrandMark({ variant = 'techclave', className = '' }: BrandMarkProps) {
  const isTechclave = variant === 'techclave';

  return (
    <Image
      src={isTechclave ? '/brand/techclave-logo.png' : '/brand/booka-logo.png'}
      alt={isTechclave ? 'Techclave logo' : 'Booka logo'}
      width={isTechclave ? 1000 : 760}
      height={isTechclave ? 320 : 340}
      unoptimized
      className={`h-auto w-auto rounded-xl object-contain ${className}`}
    />
  );
}
