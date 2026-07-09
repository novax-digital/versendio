"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { cancelJobAction } from "../../versand/actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";

export function CancelJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const cancel = () => {
    const fd = new FormData();
    fd.set("jobId", jobId);
    startTransition(async () => {
      const result = await cancelJobAction(null, fd);
      if (result.ok) {
        toast.success(de.sendJobs.canceledWithRefund(formatCents(result.refundedCents)));
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" className="text-destructive" />}>
        <Ban className="size-4" aria-hidden />
        {de.sendJobs.cancelJob}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{de.sendJobs.cancelJob}</AlertDialogTitle>
          <AlertDialogDescription>{de.sendJobs.cancelConfirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={cancel} disabled={pending}>
            {de.sendJobs.cancelJob}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
