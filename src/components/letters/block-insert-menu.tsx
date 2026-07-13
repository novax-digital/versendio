"use client";

import {
  Heading2,
  ImagePlus,
  Pilcrow,
  SeparatorHorizontal,
  TextQuote,
  UnfoldVertical,
} from "lucide-react";
import type { LetterBlock } from "@/lib/shared/letter-document";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { de } from "@/lib/i18n/de";

export const BLOCK_TYPE_META: Record<
  LetterBlock["type"],
  { label: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> }
> = {
  subject: { label: de.letters.blockSubject, icon: TextQuote },
  heading: { label: de.letters.blockHeading, icon: Heading2 },
  text: { label: de.letters.blockText, icon: Pilcrow },
  divider: { label: de.letters.blockDivider, icon: SeparatorHorizontal },
  spacer: { label: de.letters.blockSpacer, icon: UnfoldVertical },
  image: { label: de.letters.blockImage, icon: ImagePlus },
};

const ORDER: LetterBlock["type"][] = ["subject", "heading", "text", "divider", "spacer", "image"];

/** Shared dropdown content listing the six block types with distinct icons. */
export function BlockInsertMenuContent({
  onInsert,
  onInsertImage,
  align = "start",
}: {
  onInsert: (type: Exclude<LetterBlock["type"], "image">) => void;
  onInsertImage: () => void;
  align?: "start" | "center" | "end";
}) {
  return (
    <DropdownMenuContent align={align}>
      {ORDER.map((type) => {
        const meta = BLOCK_TYPE_META[type];
        const Icon = meta.icon;
        return (
          <DropdownMenuItem
            key={type}
            onClick={() => (type === "image" ? onInsertImage() : onInsert(type))}
          >
            <Icon className="size-4" aria-hidden />
            {meta.label}
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuContent>
  );
}
