'use client';

interface BookingSummaryProps {
  booking: {
    service?: {
      id: string;
      name: string;
      duration: number;
      price: number;
    };
    date?: string;
    time?: string;
    customer?: {
      name: string;
      email: string;
      phone: string;
      notes?: string;
    };
  };
  onConfirm: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}

export default function BookingSummary({
  booking,
  onConfirm,
  onBack,
  isSubmitting,
}: BookingSummaryProps) {
  const { service, date, time, customer } = booking;

  if (!service || !date || !time || !customer) {
    return null;
  }

  const dateObj = new Date(date);
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Review Your Booking</h2>
        <p className="text-slate-600 text-sm mt-1">Please confirm your appointment details</p>
      </div>

      {/* Service Summary */}
      <div className="bg-slate-50 p-4 rounded-lg space-y-3">
        <h3 className="font-semibold text-slate-900">Service</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">{service.name}</span>
            <span className="font-semibold text-slate-900">${(service.price / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Duration</span>
            <span>{service.duration} minutes</span>
          </div>
        </div>
      </div>

      {/* Date & Time Summary */}
      <div className="bg-slate-50 p-4 rounded-lg space-y-3">
        <h3 className="font-semibold text-slate-900">Appointment Details</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Date</span>
            <span className="font-semibold text-slate-900">{formattedDate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Time</span>
            <span className="font-semibold text-slate-900">{time}</span>
          </div>
        </div>
      </div>

      {/* Customer Summary */}
      <div className="bg-slate-50 p-4 rounded-lg space-y-3">
        <h3 className="font-semibold text-slate-900">Your Information</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Name</span>
            <span className="font-semibold text-slate-900">{customer.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Email</span>
            <span className="font-semibold text-slate-900 break-all">{customer.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Phone</span>
            <span className="font-semibold text-slate-900">{customer.phone}</span>
          </div>
          {customer.notes && (
            <div className="pt-2 border-t border-slate-200">
              <p className="text-slate-600">Notes</p>
              <p className="text-slate-900 mt-1">{customer.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Info Message */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          ℹ️ A confirmation email will be sent to <strong>{customer.email}</strong> with your booking details.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-6 border-t">
        <button
          onClick={onBack}
          disabled={isSubmitting}
          className="flex-1 px-4 py-2 border-2 border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Edit
        </button>
        <button
          onClick={onConfirm}
          disabled={isSubmitting}
          className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Confirming...' : 'Confirm Booking'}
        </button>
      </div>
    </div>
  );
}
