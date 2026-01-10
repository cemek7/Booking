import React from "react";
import GlassCard from "@/components/ui/GlassCard";

type UsageChartProps = {
  usage: any[]; // Replace 'any[]' with a more specific type if available
};

const UsageChart = ({ usage }: UsageChartProps) => {
  // Placeholder chart
  return (
    <GlassCard className="p-6">
      <div className="h-48 flex items-center justify-center text-gray-400">
        [Usage chart coming soon]
      </div>
    </GlassCard>
  );
};

export default UsageChart;
