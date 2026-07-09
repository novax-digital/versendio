"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { RotateCw } from "lucide-react";
import { retryItemAction } from "../actions";
import { Button } from "@/components/ui/button";
import { de } from "@/lib/i18n/de";

export function RetryButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const retry = () => {
    const fd = new FormData();
    fd.set("itemId", itemId);
    startTransition(async () => {
      const result = await retryItemAction(null, fd);
      if (result.ok) {
        toast.success(de.admin.retryQueued);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Button variant="outline" size="sm" onClick={retry} disabled={pending}>
      <RotateCw className="size-3.5" aria-hidden />
      {de.admin.retry}
    </Button>
  );
}
