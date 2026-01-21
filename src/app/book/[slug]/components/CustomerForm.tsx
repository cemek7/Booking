'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/useToast';

interface CustomerFormProps {
  onSubmit: (name: string, email: string, phone: string, notes?: string) => void;
  onBack: () => void;
}

export default function CustomerForm({ onSubmit, onBack }: CustomerFormProps) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone number is required';
    } else if (!/^\+?[\d\s\-()]+$/.test(formData.phone) || formData.phone.length < 10) {
      newErrors.phone = 'Please enter a valid phone number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear error for this field
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit(formData.name, formData.email, formData.phone, formData.notes);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Your Information</h2>
        <p className="text-slate-600 text-sm mt-1">Please provide your details</p>
      </div>

      {/* Name */}
      <div className="space-y-2">
        <label htmlFor="name" className="block text-sm font-semibold text-slate-900">
          Full Name *
        </label>
        <input
          id="name"
          name="name"
          type="text"
          value={formData.name}
          onChange={handleChange}
          placeholder="John Doe"
          className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
            errors.name
              ? 'border-red-500 focus:ring-red-500'
              : 'border-slate-300 focus:ring-blue-500'
          }`}
        />
        {errors.name && <p className="text-sm text-red-600">{errors.name}</p>}
      </div>

      {/* Email */}
      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-semibold text-slate-900">
          Email Address *
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="john@example.com"
          className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
            errors.email
              ? 'border-red-500 focus:ring-red-500'
              : 'border-slate-300 focus:ring-blue-500'
          }`}
        />
        {errors.email && <p className="text-sm text-red-600">{errors.email}</p>}
      </div>

      {/* Phone */}
      <div className="space-y-2">
        <label htmlFor="phone" className="block text-sm font-semibold text-slate-900">
          Phone Number *
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          value={formData.phone}
          onChange={handleChange}
          placeholder="+1 (555) 123-4567"
          className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
            errors.phone
              ? 'border-red-500 focus:ring-red-500'
              : 'border-slate-300 focus:ring-blue-500'
          }`}
        />
        {errors.phone && <p className="text-sm text-red-600">{errors.phone}</p>}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <label htmlFor="notes" className="block text-sm font-semibold text-slate-900">
          Additional Notes (Optional)
        </label>
        <textarea
          id="notes"
          name="notes"
          value={formData.notes}
          onChange={handleChange}
          placeholder="Any special requests or allergies?"
          rows={4}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors resize-none"
        />
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-6 border-t">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 px-4 py-2 border-2 border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Back
        </button>
        <button
          type="submit"
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
        >
          Review Booking
        </button>
      </div>
    </form>
  );
}
