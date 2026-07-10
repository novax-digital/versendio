import type { Metadata } from "next";
import { Geist_Mono, Inter, Poppins } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
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
      <body className="antialiased">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
