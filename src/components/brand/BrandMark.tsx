import Image from 'next/image';

type BrandMarkProps = {
  variant?: 'techclave' | 'booka';
  className?: string;
};

export default function BrandMark({ variant = 'techclave', className = '' }: BrandMarkProps) {
  const isTechclave = variant === 'techclave';

  return (
    <div
      data-testid="brand-mark"
      className={`relative flex items-center justify-center overflow-hidden rounded-[1.35rem] border ${
        isTechclave
          ? 'border-[#163425] bg-[#10211a]'
          : 'border-emerald-200 bg-emerald-600'
      } ${className}`}
    >
      <div data-testid="brand-mark-artwork" className="absolute inset-0">
        <Image
          src={isTechclave ? '/brand/techclave-mark.png' : '/brand/booka-mark.png'}
          alt={isTechclave ? 'Techclave logo' : 'Booka logo'}
          width={256}
          height={256}
          unoptimized
          className="h-full w-full object-cover"
        />
      </div>
      <div
        className={`pointer-events-none absolute inset-[14%] rounded-[1.05rem] border ${
          isTechclave ? 'border-[#d4b368]/30' : 'border-white/18'
        }`}
      />
    </div>
  );
}
