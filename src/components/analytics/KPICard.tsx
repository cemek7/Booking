type KPICardProps = {
  label: string;
  value: string | number;
  className?: string;
  onClick?: () => void;
};
import GlassCard from '@/components/ui/GlassCard';

export default function KPICard({ label, value, className = "", onClick }: KPICardProps) {
  return (
    <GlassCard className={`p-4 ${onClick ? 'cursor-pointer hover:scale-105 transition' : ''} ${className}`}>
      <div className="flex flex-col items-center">
        <span className="text-lg font-semibold">{value}</span>
        <span className="text-gray-500 text-sm">{label}</span>
      </div>
    </GlassCard>
  );
}
