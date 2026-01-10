import React from 'react';
import GlassCard from '@/components/ui/GlassCard';

interface LineChartProps {
  data: any; // Replace 'any' with a more specific type if possible
}

const LineChart: React.FC<LineChartProps> = ({ data }) => {
  return (
    <GlassCard className="p-4">
      {/* Line chart visualization will go here */}
      <p>Line chart placeholder.</p>
    </GlassCard>
  );
};

export default LineChart;
