import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { de } from "@/lib/i18n/de";

// Legal placeholder pages (structure per MASTERPROMPT §6.8) — final texts
// must be supplied by legal counsel before go-live.
const pages: Record<string, { title: string; intro: string }> = {
  impressum: {
    title: de.legal.imprint,
    intro:
      "Angaben gemäß § 5 DDG. Die vollständigen Anbieterangaben werden vor dem Produktivstart ergänzt.",
  },
  datenschutz: {
    title: de.legal.privacy,
    intro:
      "Informationen zur Verarbeitung personenbezogener Daten gemäß Art. 13/14 DSGVO. Die vollständige Datenschutzerklärung wird vor dem Produktivstart ergänzt.",
  },
  agb: {
    title: de.legal.terms,
    intro:
      "Allgemeine Geschäftsbedingungen für die Nutzung der Plattform. Die vollständigen AGB werden vor dem Produktivstart ergänzt.",
  },
  avv: {
    title: de.legal.dpa,
    intro:
      "Vertrag zur Auftragsverarbeitung gemäß Art. 28 DSGVO für Geschäftskunden. Der vollständige AVV wird vor dem Produktivstart ergänzt.",
  },
};

export function generateStaticParams() {
  return Object.keys(pages).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = pages[slug];
  return { title: page?.title ?? de.legal.imprint };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = pages[slug];
  if (!page) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-16">
      <h1 className="text-3xl font-semibold">{page.title}</h1>
      <p className="text-muted-foreground">{page.intro}</p>
      <div className="text-muted-foreground rounded-md border border-dashed p-6 text-sm">
        {de.admin.placeholder}
      </div>
    </div>
  );
}
