import type { Metadata } from "next";
import Link from "next/link";
import { Upload, PenLine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProfile } from "@/lib/server/auth-context";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.letters.newLetter };

export default async function NewLetterPage() {
  await requireProfile();
  const options = [
    {
      href: "/app/briefe/hochladen",
      icon: Upload,
      title: de.letters.chooseUpload,
      hint: de.letters.chooseUploadHint,
    },
    {
      href: "/app/briefe/editor",
      icon: PenLine,
      title: de.letters.chooseEditor,
      hint: de.letters.chooseEditorHint,
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{de.letters.newLetter}</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {options.map(({ href, icon: Icon, title, hint }) => (
          <Link key={href} href={href} className="focus-visible:ring-ring rounded-lg focus-visible:ring-2 focus-visible:outline-none">
            <Card className="hover:border-primary h-full transition-colors">
              <CardHeader>
                <Icon className="text-primary mb-2 size-6" aria-hidden />
                <CardTitle className="text-base">{title}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">{hint}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
