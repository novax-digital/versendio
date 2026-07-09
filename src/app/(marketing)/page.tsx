import Link from "next/link";
import { FileCheck, Users, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { de } from "@/lib/i18n/de";

const features = [
  { icon: FileCheck, title: de.marketing.featurePdfTitle, text: de.marketing.featurePdfText },
  { icon: Users, title: de.marketing.featureListsTitle, text: de.marketing.featureListsText },
  { icon: Route, title: de.marketing.featureTrackingTitle, text: de.marketing.featureTrackingText },
];

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ konto?: string }>;
}) {
  const { konto } = await searchParams;
  return (
    <div className="mx-auto max-w-5xl space-y-16 px-4 py-16">
      {konto === "geloescht" ? (
        <p
          role="status"
          className="mx-auto max-w-2xl rounded-md bg-emerald-50 p-4 text-center text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
        >
          {de.profile.accountDeleted}
        </p>
      ) : null}
      <section className="mx-auto max-w-3xl space-y-6 text-center">
        <h1 className="text-4xl font-semibold text-balance sm:text-5xl">
          {de.marketing.heroTitle}
        </h1>
        <p className="text-muted-foreground mx-auto max-w-2xl text-lg text-pretty">
          {de.marketing.heroSubtitle}
        </p>
        <div className="flex justify-center gap-3">
          <Button size="lg" render={<Link href="/registrieren" />}>
            {de.marketing.ctaRegister}
          </Button>
          <Button size="lg" variant="outline" render={<Link href="/login" />}>
            {de.marketing.ctaLogin}
          </Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {features.map(({ icon: Icon, title, text }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="text-primary mb-2 size-6" aria-hidden />
              <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">{text}</CardContent>
          </Card>
        ))}
      </section>

      <section className="bg-muted mx-auto max-w-3xl rounded-lg p-8 text-center">
        <h2 className="text-2xl font-semibold">{de.marketing.pricingTitle}</h2>
        <p className="text-muted-foreground mt-2">{de.marketing.pricingText}</p>
      </section>
    </div>
  );
}
