'use client';

import { useState } from 'react';
import BookingContainer from './BookingContainer';
import ReviewsSection from './ReviewsSection';
import FaqSection from './FaqSection';

type Tab = 'book' | 'about' | 'services' | 'reviews' | 'faq';

interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  industry?: string;
  address?: string;
  phone?: string;
  website?: string;
}

interface Service {
  id: string;
  name: string;
  description?: string;
  duration?: number;
  price?: number;
  image_url?: string;
}

interface MiniSiteContainerProps {
  tenant: TenantInfo;
  services: Service[];
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'book', label: 'Book' },
  { id: 'about', label: 'About' },
  { id: 'services', label: 'Services' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'faq', label: 'FAQ' },
];

function formatCurrency(price: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(price);
}

function ServicesTab({ services }: { services: Service[] }) {
  if (services.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-slate-500 text-sm">No services listed yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900">Our Services</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {services.map((service) => (
          <div key={service.id} className="bg-white border rounded-xl p-4 space-y-1">
            {service.image_url && (
              <img src={service.image_url} alt={service.name} className="w-full h-32 object-cover rounded-lg mb-2" />
            )}
            <h3 className="font-semibold text-slate-900">{service.name}</h3>
            {service.description && (
              <p className="text-sm text-slate-600">{service.description}</p>
            )}
            <div className="flex items-center justify-between pt-1">
              {service.duration && (
                <span className="text-xs text-slate-500">{service.duration} mins</span>
              )}
              {service.price !== undefined && service.price > 0 && (
                <span className="text-sm font-semibold text-indigo-600">
                  {formatCurrency(service.price)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AboutTab({ tenant }: { tenant: TenantInfo }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">About Us</h2>
        {tenant.description ? (
          <p className="text-slate-600 mt-2 leading-relaxed">{tenant.description}</p>
        ) : (
          <p className="text-slate-400 mt-2 text-sm">No description available.</p>
        )}
      </div>

      {(tenant.address || tenant.phone || tenant.website) && (
        <div className="bg-slate-50 rounded-xl p-4 space-y-2">
          <h3 className="font-semibold text-sm text-slate-700">Contact & Location</h3>
          {tenant.address && (
            <div className="flex items-start gap-2 text-sm text-slate-600">
              <span>📍</span>
              <span>{tenant.address}</span>
            </div>
          )}
          {tenant.phone && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>📞</span>
              <a href={`tel:${tenant.phone}`} className="hover:underline">{tenant.phone}</a>
            </div>
          )}
          {tenant.website && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>🌐</span>
              <a href={tenant.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {tenant.website.replace(/^https?:\/\//, '')}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MiniSiteContainer({ tenant, services }: MiniSiteContainerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('book');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <div className="flex items-start gap-4">
          {tenant.logo && (
            <img src={tenant.logo} alt={tenant.name} className="w-16 h-16 rounded-xl object-cover" />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-slate-900">{tenant.name}</h1>
            {tenant.industry && (
              <p className="text-xs text-indigo-600 font-medium uppercase tracking-wide mt-0.5">
                {tenant.industry}
              </p>
            )}
            {tenant.description && (
              <p className="text-slate-600 mt-1 text-sm line-clamp-2">{tenant.description}</p>
            )}
          </div>
        </div>

        {/* CTA row */}
        <div className="mt-4 pt-4 border-t flex items-center gap-3">
          <button
            onClick={() => setActiveTab('book')}
            className="px-5 py-2 bg-indigo-600 text-white text-sm rounded-lg font-medium hover:bg-indigo-700"
          >
            Book Now
          </button>
          {tenant.phone && (
            <a
              href={`tel:${tenant.phone}`}
              className="px-4 py-2 border text-sm rounded-lg text-slate-700 hover:bg-slate-50"
            >
              Call Us
            </a>
          )}
        </div>
      </div>

      {/* Tab navigation */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex overflow-x-auto border-b border-slate-100">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-none px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/40'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'book' && (
            <BookingContainer slug={tenant.slug} tenantId={tenant.id} />
          )}
          {activeTab === 'about' && <AboutTab tenant={tenant} />}
          {activeTab === 'services' && <ServicesTab services={services} />}
          {activeTab === 'reviews' && <ReviewsSection slug={tenant.slug} />}
          {activeTab === 'faq' && <FaqSection slug={tenant.slug} />}
        </div>
      </div>
    </div>
  );
}
