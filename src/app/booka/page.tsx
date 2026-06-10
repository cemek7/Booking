import type { Metadata } from 'next';
import BookaLanding from '@/components/homepage/BookaLanding';

export const metadata: Metadata = {
  title: 'Booka | AI Front Desk for Service Businesses',
  description: 'WhatsApp + Instagram bookings, reminders, follow-up, and revenue recovery for salons, clinics, and hospitality teams.',
};

export default function BookaPage() {
  return <BookaLanding />;
}
