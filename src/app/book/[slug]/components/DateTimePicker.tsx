'use client';

import { useEffect, useState, useMemo } from 'react';
import { publicBookingAPI } from '@/lib/publicBookingAPI';
import { useToast } from '@/hooks/useToast';
import LoadingSpinner from './LoadingSpinner';

interface DateTimePickerProps {
  slug: string;
  serviceId: string;
  duration: number;
  onSelect: (date: string, time: string) => void;
  onBack: () => void;
}

interface TimeSlot {
  time: string;
  available: boolean;
}

export default function DateTimePicker({
  slug,
  serviceId,
  duration,
  onSelect,
  onBack,
}: DateTimePickerProps) {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Get next 7 days
  const availableDates = useMemo(() => {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      dates.push(date.toISOString().split('T')[0]);
    }
    return dates;
  }, []);

  // Load time slots when date changes
  useEffect(() => {
    if (!selectedDate) return;

    const loadTimeSlots = async () => {
      setLoading(true);
      try {
        const slots = await publicBookingAPI.getAvailability({
          slug,
          serviceId,
          date: selectedDate,
        });
        setTimeSlots(slots);
        setSelectedTime('');
      } catch (error) {
        toast({
          title: 'Error Loading Time Slots',
          description: 'Failed to load available times. Please try again.',
          type: 'error',
        });
      } finally {
        setLoading(false);
      }
    };

    loadTimeSlots();
  }, [selectedDate, slug, serviceId, toast]);

  const handleContinue = () => {
    if (!selectedDate || !selectedTime) {
      toast({
        title: 'Missing Selection',
        description: 'Please select both date and time',
        type: 'error',
      });
      return;
    }
    onSelect(selectedDate, selectedTime);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Select Date & Time</h2>
        <p className="text-slate-600 text-sm mt-1">Service duration: {duration} minutes</p>
      </div>

      {/* Date Selection */}
      <div className="space-y-3">
        <label className="block text-sm font-semibold text-slate-900">Choose a Date</label>
        <div className="grid grid-cols-4 gap-2">
          {availableDates.map((date) => {
            const dateObj = new Date(date);
            const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
            const day = dateObj.getDate();

            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`p-2 rounded-lg border-2 transition-colors text-center ${
                  selectedDate === date
                    ? 'border-blue-600 bg-blue-50 text-blue-900'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="text-xs font-semibold">{dayName}</div>
                <div className="text-lg font-bold">{day}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Time Selection */}
      {selectedDate && (
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-slate-900">Choose a Time</label>
          {loading ? (
            <LoadingSpinner />
          ) : timeSlots.length === 0 ? (
            <p className="text-slate-600 text-sm">No available times for this date</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {timeSlots.map((slot) => (
                <button
                  key={slot.time}
                  onClick={() => setSelectedTime(slot.time)}
                  disabled={!slot.available}
                  className={`p-2 rounded-lg border-2 transition-colors text-center font-semibold ${
                    !slot.available
                      ? 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
                      : selectedTime === slot.time
                        ? 'border-blue-600 bg-blue-50 text-blue-900'
                        : 'border-slate-200 hover:border-blue-300 text-slate-900'
                  }`}
                >
                  {slot.time}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 pt-6 border-t">
        <button
          onClick={onBack}
          className="flex-1 px-4 py-2 border-2 border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleContinue}
          disabled={!selectedDate || !selectedTime}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
