import type { Metadata } from "next";
import Script from "next/script";
import { Geist_Mono, Inter, Poppins } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ConsentManager } from "@/components/consent/consent-manager";
import { de } from "@/lib/i18n/de";
import "./globals.css";

// Brandbook: Poppins for brand & headings, Inter for interface & body copy.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const poppins = Poppins({ variable: "--font-poppins", weight: ["500", "600"], subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: de.common.appName,
    template: `%s · ${de.common.appName}`,
  },
  description: de.marketing.heroSubtitle,
  icons: {
    icon: [
      { url: "/brand/versendio-icon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="de"
      suppressHydrationWarning
      className={`${inter.variable} ${poppins.variable} ${geistMono.variable}`}
    >
      <head>
        {/* Consent Mode v2 stub — must run before anything else so gtag() calls
            never crash and the default (all denied) is set prior to any tag.
            gtag.js itself is loaded later, and only after a marketing grant
            (strict Basic Mode). This is the single place the stub is defined. */}
        <Script id="consent-stub" strategy="beforeInteractive">
          {`window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = gtag;
            gtag('consent', 'default', {
              ad_storage: 'denied',
              ad_user_data: 'denied',
              ad_personalization: 'denied',
              analytics_storage: 'denied'
            });`}
        </Script>
      </head>
      <body className="antialiased">
        {children}
        <Toaster position="top-right" richColors />
        <ConsentManager />
      </body>
    </html>
  );
}
