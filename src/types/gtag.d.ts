// Global typings for the Google Ads gtag.js snippet loaded in the root layout.
// Keeps window.gtag / window.dataLayer strongly typed so call sites need no `any`.
export {};

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}
