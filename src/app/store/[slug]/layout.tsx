import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shop',
  description: 'Browse and order online',
};

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  // Full-bleed: the storefront manages its own sticky header, width and padding
  // so it reads like a real shop rather than a boxed form.
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
