// Jest globals are available without import
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityFeed } from '@/components/ActivityFeed';

describe('ActivityFeed', () => {
  it('renders empty state', () => {
    render(<ActivityFeed items={[]} />);
    expect(screen.getByText(/No recent activity/)).toBeTruthy();
  });
  it('renders items and fires onClick', () => {
    const onClick = jest.fn();
    const items = [{ id: 'a1', eventType: 'booking.created', summary: 'Booking #123 created', createdAt: new Date().toISOString() }];
    render(<ActivityFeed items={items} onClick={onClick} />);
    expect(screen.getByLabelText('activity-feed')).toBeTruthy();
    fireEvent.click(screen.getByText(/Booking #123/));
    expect(onClick).toHaveBeenCalledWith(items[0]);
  });
});
