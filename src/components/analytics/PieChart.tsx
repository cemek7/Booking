import React from 'react';
import GlassCard from '@/components/ui/GlassCard';

type PieChartProps = {
  data: any[];
};

function PieChart({ data }: PieChartProps) {
  return (
    <GlassCard className="p-4">
      {/* Pie chart visualization will go here */}
      <p>Pie chart placeholder.</p>
    </GlassCard>
  );
}

export default PieChart;
