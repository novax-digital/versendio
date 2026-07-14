"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { de } from "@/lib/i18n/de";

/** Small icon button that copies `value` to the clipboard with a brief check. */
export function CopyButton({
  value,
  className,
  label,
}: {
  value: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      toast.success(de.common.copied);
      // Reset the check after a moment (runtime timer, client-only).
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={copy}
      className={cn("size-7 shrink-0", className)}
      aria-label={label ?? de.common.copy}
    >
      {copied ? (
        <Check className="text-success size-3.5" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </Button>
  );
}

/** A read-only value shown in a bordered box with a copy icon (token/URL/email). */
export function CopyableValue({
  value,
  className,
  label,
}: {
  value: string;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={cn(
        "bg-muted/40 flex items-center gap-1 rounded-md border py-1 pr-1 pl-3",
        className,
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-sm">{value}</code>
      <CopyButton value={value} label={label} />
    </div>
  );
}
