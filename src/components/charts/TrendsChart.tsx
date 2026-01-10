"use client";
import React from 'react';

export default function TrendsChart({ data = [], range = 30 }: { data?: any[]; range?: number }) {
  // lightweight placeholder chart - replace with real chart library as needed
  const points = Array.isArray(data) ? data.map((d: any) => d.count ?? 0) : [];
  return (
    <div className="w-full h-full flex items-center justify-center text-sm text-slate-500">
      {points.length === 0 ? (
        <div>No trend data</div>
      ) : (
        <div className="w-full p-4">
          <div className="text-xs text-slate-400 mb-2">Showing last {range} days</div>
          <div className="w-full h-40 bg-gradient-to-r from-blue-50 to-white rounded-md flex items-end gap-1 p-2">
            {points.map((p: number, i: number) => (
              <div key={i} style={{ height: `${Math.min(100, p)}%` }} className="flex-1 bg-blue-500/70 rounded" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
