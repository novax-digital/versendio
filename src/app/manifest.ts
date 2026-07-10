import type { MetadataRoute } from "next";
import { de } from "@/lib/i18n/de";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: de.common.appName,
    short_name: de.common.appName,
    description: de.marketing.heroSubtitle,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2C4BE8",
    icons: [
      { src: "/brand/appicon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/appicon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
