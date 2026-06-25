type BrandMarkProps = {
  variant?: 'techclave' | 'booka';
  className?: string;
};

export default function BrandMark({ variant = 'techclave', className = '' }: BrandMarkProps) {
  const isTechclave = variant === 'techclave';

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-[1.35rem] border ${
        isTechclave
          ? 'border-[#163425] bg-[#10211a] text-[#f3efe3]'
          : 'border-emerald-200 bg-emerald-600 text-white'
      } ${className}`}
    >
      <div
        className={`absolute inset-[14%] rounded-[1.05rem] border ${
          isTechclave ? 'border-[#d4b368]/30' : 'border-white/18'
        }`}
      />
      <div
        className={`absolute h-[64%] w-[64%] rounded-[0.95rem] ${
          isTechclave ? 'bg-[linear-gradient(135deg,#173227_0%,#0d1713_100%)]' : 'bg-emerald-700/75'
        }`}
      />
      <span className="relative text-sm font-semibold tracking-[0.18em]">
        {isTechclave ? 'TC' : 'B'}
      </span>
    </div>
  );
}
