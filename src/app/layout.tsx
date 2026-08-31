import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import RootChrome from "@/components/system/RootChrome";

// Self-hosted (latin subset, variable-weight woff2) so production builds do not
// depend on fetching from Google Fonts at build time. Source files live in
// ./fonts and are committed to the repo. See src/app/fonts/README.md.
const brandSans = localFont({
  src: "./fonts/Mulish-latin-var.woff2",
  display: "swap",
  weight: "200 1000",
  style: "normal",
  variable: "--font-booka-sans-loaded",
});

const brandDisplay = localFont({
  src: "./fonts/Fraunces-latin-var.woff2",
  display: "swap",
  weight: "400 700",
  style: "normal",
  variable: "--font-booka-display-loaded",
});

export const metadata: Metadata = {
  title: "Techclave | AI Operating Systems for African Businesses",
  description:
    "Techclave builds AI products for customer operations. Booka is the first product: an AI Revenue Front Desk that turns WhatsApp and Instagram enquiries into booked and paying customers.",
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
