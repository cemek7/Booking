"use client";

import React from 'react';
import ReservationsList from '@/components/reservations/ReservationsList';

export default function Page() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Reservations</h1>
      <ReservationsList />
    </div>
  );
}
