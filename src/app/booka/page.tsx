import type { Metadata } from 'next';
import BookaLanding from '@/components/homepage/BookaLanding';

export const metadata: Metadata = {
  title: 'Booka | AI Revenue Front Desk',
  description:
    'Booka turns WhatsApp and Instagram enquiries into booked and paying customers with recommendations, booking, payment links, follow-up and human escalation.',
};

export default function BookaPage() {
  return <BookaLanding />;
}
