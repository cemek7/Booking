import type { Metadata } from "next";
import { Mulish, Fraunces } from "next/font/google";
import "./globals.css";
import RootChrome from "@/components/system/RootChrome";

const brandSans = Mulish({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-booka-sans-loaded",
});

const brandDisplay = Fraunces({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-booka-display-loaded",
});

export const metadata: Metadata = {
  title: "Techclave | AI Operating Systems for African Businesses",
  description:
    "Techclave builds AI products for customer operations. Booka is the first product: an AI front desk for beauty, hospitality, and clinic teams that handles sales, bookings, and follow-up on WhatsApp and Instagram.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  return (
    <html lang="en" className={`${brandSans.variable} ${brandDisplay.variable}`}>
      <body className="brand-theme antialiased">
        <RootChrome posthogKey={posthogKey} posthogHost={posthogHost}>
          {children}
        </RootChrome>
      </body>
    </html>
  );
}
