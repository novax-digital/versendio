"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { approveReviewRewardAction, rejectReviewRewardAction } from "./actions";
import { Button } from "@/components/ui/button";
import { de } from "@/lib/i18n/de";

export function ReviewActionButtons({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (
    action: typeof approveReviewRewardAction,
    successMsg: string,
  ) => {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      const result = await action(null, fd);
      if (result.ok) {
        toast.success(successMsg);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex justify-end gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => run(rejectReviewRewardAction, de.admin.reviewRejected)}
      >
        <X className="size-3.5" aria-hidden />
        {de.admin.reviewReject}
      </Button>
      <Button
        size="sm"
        disabled={pending}
        onClick={() => run(approveReviewRewardAction, de.admin.reviewApproved)}
      >
        <Check className="size-3.5" aria-hidden />
        {de.admin.reviewApprove}
      </Button>
    </div>
  );
}
