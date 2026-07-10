import type { Metadata } from 'next';
import BookaLanding from '@/components/homepage/BookaLanding';

export const metadata: Metadata = {
  title: 'Booka | AI Front Desk for Service Businesses',
  description: 'An AI front desk that handles sales, bookings, reminders, follow-up, and revenue recovery on WhatsApp and Instagram for service businesses.',
};

export default function BookaPage() {
  return <BookaLanding />;
}
