import type { Metadata } from "next";
import { WelcomeClient } from "./welcome-client";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.auth.welcomeHeading };

export default function WelcomePage() {
  return <WelcomeClient />;
}
