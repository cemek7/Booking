"use client";
import React, { createContext, useContext, useEffect, useState } from 'react';

export type Location = { id: string; name?: string } | null;

interface LocationContextValue {
  location: Location;
  setLocation: (loc: Location) => void;
  clearLocation: () => void;
}

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocationState] = useState<Location>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('current_location');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.id) setLocationState({ id: parsed.id, name: parsed.name });
      }
    } catch {}
  }, []);

  function setLocation(loc: Location) {
    setLocationState(loc);
    try {
      if (typeof window !== 'undefined') {
        if (loc) localStorage.setItem('current_location', JSON.stringify(loc));
        else localStorage.removeItem('current_location');
      }
    } catch {}
  }

  function clearLocation() { setLocation(null); }

  return <LocationContext.Provider value={{ location, setLocation, clearLocation }}>{children}</LocationContext.Provider>;
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used within LocationProvider');
  return ctx;
}

export default LocationProvider;
