"use client";
import React, { memo, useCallback } from 'react';

export interface ActivityItem {
  id: string;
  eventType: string;
  summary: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

interface ActivityItemProps {
  item: ActivityItem;
  onClick?: (item: ActivityItem) => void;
}

const ActivityFeedItem = memo<ActivityItemProps>(function ActivityFeedItem({ item, onClick }) {
  const handleClick = useCallback(() => {
    onClick?.(item);
  }, [onClick, item]);

  return (
    <li
      className="p-3 flex items-start gap-3 hover:bg-gray-50 cursor-pointer"
      onClick={handleClick}
    >
      <span
        className="text-xs uppercase tracking-wide px-2 py-1 rounded bg-gray-100"
        aria-label={`event-${item.eventType}`}
      >
        {item.eventType}
      </span>
      <div className="flex-1">
        <p className="text-sm font-medium" aria-label="summary">
          {item.summary}
        </p>
        <p className="text-xs text-gray-500" aria-label="timestamp">
          {new Date(item.createdAt).toLocaleString()}
        </p>
      </div>
    </li>
  );
});

export interface ActivityFeedProps {
  items: ActivityItem[];
  onClick?: (item: ActivityItem) => void;
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ items, onClick }) => {
  if (!items || items.length === 0) {
    return <div className="p-4 text-sm text-gray-500">No recent activity.</div>;
  }

  return (
    <ul className="divide-y border rounded bg-white" aria-label="activity-feed">
      {items.map((item) => (
        <ActivityFeedItem key={item.id} item={item} onClick={onClick} />
      ))}
    </ul>
  );
};

export default ActivityFeed;
