"use client";
import React from 'react';

export interface ActivityItem {
  id: string;
  eventType: string;
  summary: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}
export interface ActivityFeedProps { items: ActivityItem[]; onClick?: (item: ActivityItem) => void; }

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ items, onClick }) => {
  if (!items || items.length === 0) return <div className="p-4 text-sm text-gray-500">No recent activity.</div>;
  return (
    <ul className="divide-y border rounded bg-white" aria-label="activity-feed">
      {items.map(item => (
        <li key={item.id} className="p-3 flex items-start gap-3 hover:bg-gray-50 cursor-pointer" onClick={() => onClick?.(item)}>
          <span className="text-xs uppercase tracking-wide px-2 py-1 rounded bg-gray-100" aria-label={`event-${item.eventType}`}>{item.eventType}</span>
          <div className="flex-1">
            <p className="text-sm font-medium" aria-label="summary">{item.summary}</p>
            <p className="text-xs text-gray-500" aria-label="timestamp">{new Date(item.createdAt).toLocaleString()}</p>
          </div>
        </li>
      ))}
    </ul>
  );
};

export default ActivityFeed;
