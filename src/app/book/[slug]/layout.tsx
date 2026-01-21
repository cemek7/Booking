import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Book an Appointment',
  description: 'Schedule your appointment online with our booking system',
};

export default function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <main className="container mx-auto max-w-2xl px-4 py-8 md:py-12">
        {children}
      </main>
    </div>
  );
}
