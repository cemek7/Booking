import { Suspense } from 'react';
import Link from 'next/link';

interface ConfirmationPageProps {
  params: {
    slug: string;
  };
  searchParams: {
    bookingId?: string;
  };
}

export const metadata = {
  title: 'Booking Confirmed',
  description: 'Your appointment has been successfully booked',
};

export default function ConfirmationPage({
  params,
  searchParams,
}: ConfirmationPageProps) {
  const bookingId = searchParams.bookingId;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center space-y-6">
          {/* Success Icon */}
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
          </div>

          {/* Title */}
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Booking Confirmed!</h1>
            <p className="text-slate-600 mt-2">
              Your appointment has been successfully scheduled.
            </p>
          </div>

          {/* Booking ID */}
          {bookingId && (
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-sm text-slate-600">Booking Reference</p>
              <p className="text-lg font-mono font-semibold text-slate-900 mt-1 break-all">
                {bookingId}
              </p>
            </div>
          )}

          {/* Confirmation Details */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-900">
              📧 A confirmation email has been sent with all the details. <br />
              Please save it for future reference.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 pt-6 border-t">
            <Link
              href={`/book/${params.slug}`}
              className="block w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors text-center"
            >
              Book Another Appointment
            </Link>
            <Link
              href="/"
              className="block w-full px-4 py-2 border-2 border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50 transition-colors text-center"
            >
              Return to Home
            </Link>
          </div>

          {/* Help Text */}
          <div className="text-sm text-slate-600 pt-4">
            <p>Have questions? Contact us at support@booka.io</p>
          </div>
        </div>
      </div>
    </div>
  );
}
