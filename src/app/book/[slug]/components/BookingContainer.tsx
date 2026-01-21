'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import TenantHeader from './TenantHeader';
import ServiceSelector from './ServiceSelector';
import DateTimePicker from './DateTimePicker';
import CustomerForm from './CustomerForm';
import BookingSummary from './BookingSummary';
import LoadingSpinner from './LoadingSpinner';
import { publicBookingAPI } from '@/lib/publicBookingAPI';
import { useToast } from '@/hooks/useToast';

interface BookingStep {
  step: 'service' | 'datetime' | 'customer' | 'summary' | 'loading';
}

interface BookingData {
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
}

interface BookingContainerProps {
  slug: string;
  tenantId: string;
}

export default function BookingContainer({ slug, tenantId }: BookingContainerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState<BookingStep['step']>('service');
  const [bookingData, setBookingData] = useState<BookingData>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleServiceSelect = useCallback(
    (serviceId: string, serviceName: string, duration: number, price: number) => {
      setBookingData((prev) => ({
        ...prev,
        service: { id: serviceId, name: serviceName, duration, price },
      }));
      setCurrentStep('datetime');
    },
    []
  );

  const handleDateTimeSelect = useCallback(
    (date: string, time: string) => {
      setBookingData((prev) => ({
        ...prev,
        date,
        time,
      }));
      setCurrentStep('customer');
    },
    []
  );

  const handleCustomerInfo = useCallback(
    (name: string, email: string, phone: string, notes?: string) => {
      setBookingData((prev) => ({
        ...prev,
        customer: { name, email, phone, notes },
      }));
      setCurrentStep('summary');
    },
    []
  );

  const handleConfirmBooking = useCallback(async () => {
    if (!bookingData.service || !bookingData.date || !bookingData.time || !bookingData.customer) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in all required fields',
        type: 'error',
      });
      return;
    }

    setIsSubmitting(true);
    setCurrentStep('loading');

    try {
      const result = await publicBookingAPI.createPublicBooking({
        slug,
        serviceId: bookingData.service.id,
        date: bookingData.date,
        time: bookingData.time,
        customerName: bookingData.customer.name,
        customerEmail: bookingData.customer.email,
        customerPhone: bookingData.customer.phone,
        notes: bookingData.customer.notes,
      });

      toast({
        title: 'Booking Confirmed! 🎉',
        description: `Your appointment is scheduled for ${bookingData.date} at ${bookingData.time}`,
        type: 'success',
      });

      // Redirect to confirmation page
      setTimeout(() => {
        router.push(`/book/${slug}/confirmation?bookingId=${result.id}`);
      }, 1500);
    } catch (error) {
      console.error('Booking error:', error);
      toast({
        title: 'Booking Failed',
        description: error instanceof Error ? error.message : 'Something went wrong. Please try again.',
        type: 'error',
      });
      setCurrentStep('customer');
    } finally {
      setIsSubmitting(false);
    }
  }, [bookingData, tenantId, slug, router, toast]);

  const handleBack = useCallback(() => {
    switch (currentStep) {
      case 'datetime':
        setCurrentStep('service');
        setBookingData((prev) => {
          const { service, ...rest } = prev;
          return rest;
        });
        break;
      case 'customer':
        setCurrentStep('datetime');
        setBookingData((prev) => {
          const { date, time, ...rest } = prev;
          return rest;
        });
        break;
      case 'summary':
        setCurrentStep('customer');
        setBookingData((prev) => {
          const { customer, ...rest } = prev;
          return rest;
        });
        break;
    }
  }, [currentStep]);

  return (
    <div className="space-y-8">
      {/* Progress Indicator */}
      <div className="flex items-center justify-between">
        {(['service', 'datetime', 'customer', 'summary'] as const).map((step, index) => (
          <div key={step} className="flex items-center">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                step === 'service'
                  ? 'bg-blue-600 text-white'
                  : ['datetime', 'customer', 'summary'].includes(step) &&
                      ['datetime', 'customer', 'summary'].indexOf(step as any) <
                        ['datetime', 'customer', 'summary'].indexOf(currentStep as any)
                    ? 'bg-green-600 text-white'
                    : currentStep === step
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-200 text-slate-600'
              }`}
            >
              {index + 1}
            </div>
            {index < 3 && (
              <div
                className={`mx-2 h-1 w-8 transition-colors md:w-12 ${
                  ['datetime', 'customer', 'summary'].includes(step) &&
                  ['datetime', 'customer', 'summary'].indexOf(step as any) <
                    ['datetime', 'customer', 'summary'].indexOf(currentStep as any)
                    ? 'bg-green-600'
                    : currentStep === step ||
                        (['datetime', 'customer', 'summary'].includes(step) &&
                          ['datetime', 'customer', 'summary'].indexOf(step as any) <
                            ['datetime', 'customer', 'summary'].indexOf(currentStep as any))
                      ? 'bg-blue-600'
                      : 'bg-slate-200'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Header */}
      <TenantHeader slug={slug} />

      {/* Content */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        {currentStep === 'service' && <ServiceSelector slug={slug} onSelect={handleServiceSelect} />}

        {currentStep === 'datetime' && bookingData.service && (
          <DateTimePicker
            slug={slug}
            serviceId={bookingData.service.id}
            duration={bookingData.service.duration}
            onSelect={handleDateTimeSelect}
            onBack={handleBack}
          />
        )}

        {currentStep === 'customer' && (
          <CustomerForm onSubmit={handleCustomerInfo} onBack={handleBack} />
        )}

        {currentStep === 'summary' && bookingData.service && bookingData.date && bookingData.time && bookingData.customer && (
          <BookingSummary
            booking={bookingData}
            onConfirm={handleConfirmBooking}
            onBack={handleBack}
            isSubmitting={isSubmitting}
          />
        )}

        {currentStep === 'loading' && <LoadingSpinner />}
      </div>
    </div>
  );
}
