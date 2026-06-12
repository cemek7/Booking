import type { Metadata } from "next";
import { Mulish, Fraunces } from "next/font/google";
import "./globals.css";
import AuthHashRedirect from "@/components/AuthHashRedirect";
import { ToastContainer } from "@/components/ui/toast";
import AnalyticsProvider from "@/components/analytics/AnalyticsProvider";
import ConsentBanner from "@/components/consent/ConsentBanner";

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
    "Techclave builds AI products for customer operations. Booka is the first product: a WhatsApp-first AI front desk for salons, clinics, and hospitality teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${brandSans.variable} ${brandDisplay.variable}`}>
      <body className="brand-theme antialiased">
        <AnalyticsProvider>
          <AuthHashRedirect />
          <ToastContainer />
          {children}
          <ConsentBanner />
        </AnalyticsProvider>
      </body>
    </html>
  );
}
