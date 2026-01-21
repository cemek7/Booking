'use client';

import { useEffect, useState } from 'react';
import { publicBookingAPI } from '@/lib/publicBookingAPI';
import { useToast } from '@/hooks/useToast';
import LoadingSpinner from './LoadingSpinner';

interface Service {
  id: string;
  name: string;
  description?: string;
  duration: number;
  price: number;
}

interface ServiceSelectorProps {
  slug: string;
  onSelect: (serviceId: string, serviceName: string, duration: number, price: number) => void;
}

export default function ServiceSelector({ slug, onSelect }: ServiceSelectorProps) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const loadServices = async () => {
      try {
        const data = await publicBookingAPI.getTenantServices(slug);
        setServices(data);
      } catch (error) {
        toast({
          title: 'Error Loading Services',
          description: 'Failed to load available services. Please try again.',
          type: 'error',
        });
      } finally {
        setLoading(false);
      }
    };

    loadServices();
  }, [slug, toast]);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (services.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-600">No services available at the moment.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-slate-900">Select a Service</h2>
      <p className="text-slate-600">Choose the service you'd like to book</p>

      <div className="grid gap-3 mt-6">
        {services.map((service) => (
          <button
            key={service.id}
            onClick={() => onSelect(service.id, service.name, service.duration, service.price)}
            className="text-left p-4 border-2 border-slate-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900">{service.name}</h3>
                {service.description && (
                  <p className="text-sm text-slate-600 mt-1">{service.description}</p>
                )}
                <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
                  <span>⏱️ {service.duration} mins</span>
                  {service.price > 0 && <span>💰 ${(service.price / 100).toFixed(2)}</span>}
                </div>
              </div>
              <div className="ml-4 text-blue-600 font-semibold">→</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
