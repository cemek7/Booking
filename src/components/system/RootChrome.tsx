'use client';
import { usePathname } from 'next/navigation';
import AnalyticsProvider from '@/components/analytics/AnalyticsProvider';
import ConsentBanner from '@/components/consent/ConsentBanner';
import AuthHashRedirect from '@/components/AuthHashRedirect';
import { ToastContainer } from '@/components/ui/toast';

export default function RootChrome({
  children, posthogKey, posthogHost,
}: { children: React.ReactNode; posthogKey?: string; posthogHost?: string }) {
  const pathname = usePathname() ?? '';
  if (pathname.startsWith('/showcase')) {
    // Standalone microsite feel: no Booka analytics/consent chrome.
    return <>{children}</>;
  }
  return (
    <AnalyticsProvider posthogKey={posthogKey} posthogHost={posthogHost}>
      <AuthHashRedirect />
      <ToastContainer />
      {children}
      <ConsentBanner />
    </AnalyticsProvider>
  );
}
