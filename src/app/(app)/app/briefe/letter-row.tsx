import Link from "next/link";
import { FileText, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { de } from "@/lib/i18n/de";

type LetterListItem = {
  id: string;
  title: string;
  source: "upload" | "editor";
  page_count: number | null;
  sheet_count: number | null;
  status: "draft" | "ready";
  has_placeholders: boolean;
};

export function LetterRow({ letter }: { letter: LetterListItem }) {
  const href =
    letter.source === "editor" ? `/app/briefe/editor/${letter.id}` : `/app/briefe/${letter.id}`;
  const Icon = letter.source === "editor" ? Pencil : FileText;

  return (
    <li>
      <Link
        href={href}
        className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition-colors"
      >
        <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{letter.title}</p>
          <p className="text-muted-foreground text-xs">
            {letter.source === "editor" ? de.letters.sourceEditor : de.letters.sourceUpload}
            {letter.page_count ? ` · ${letter.page_count} ${de.letters.pageCount}` : ""}
          </p>
        </div>
        {letter.has_placeholders ? <Badge variant="secondary">Serienbrief</Badge> : null}
        <Badge variant={letter.status === "ready" ? "outline" : "secondary"}>
          {letter.status === "ready" ? de.letters.statusReady : de.letters.statusDraft}
        </Badge>
      </Link>
    </li>
  );
}
