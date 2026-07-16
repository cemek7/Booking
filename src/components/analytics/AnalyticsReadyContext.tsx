'use client';

import React, { createContext, useContext } from 'react';

const AnalyticsReadyContext = createContext(false);

export function AnalyticsReadyProvider({
  ready,
  children,
}: {
  ready: boolean;
  children: React.ReactNode;
}) {
  return (
    <AnalyticsReadyContext.Provider value={ready}>
      {children}
    </AnalyticsReadyContext.Provider>
  );
}

export function useAnalyticsReady() {
  return useContext(AnalyticsReadyContext);
}
