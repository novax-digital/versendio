"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Ban, Send, Square } from "lucide-react";
import { releaseSendJobAction, stopSendJobAction } from "../actions";
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
import { de } from "@/lib/i18n/de";

export function ReviewActions({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const t = de.admin.review;

  const run = (
    fn: (
      prev: unknown,
      fd: FormData,
    ) => Promise<{ ok: true; data?: { message: string } } | { ok: false; error: string }>,
    fields: Record<string, string>,
    successMsg: string,
  ) => {
    const fd = new FormData();
    fd.set("jobId", jobId);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    startTransition(async () => {
      const result = await fn(null, fd);
      if (result.ok) {
        // Stop reports what it actually caught (some letters may be out).
        toast.success(result.data?.message ?? successMsg, { duration: 10_000 });
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        size="sm"
        onClick={() => run(releaseSendJobAction, {}, t.released)}
        disabled={pending}
      >
        <Send className="size-3.5" aria-hidden />
        {t.release}
      </Button>

      <AlertDialog>
        <AlertDialogTrigger render={<Button size="sm" variant="outline" disabled={pending} />}>
          <Square className="size-3.5" aria-hidden />
          {t.stop}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.stop}</AlertDialogTitle>
            <AlertDialogDescription>{t.stopConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => run(stopSendJobAction, { block: "false" }, t.stop)}
              disabled={pending}
            >
              {t.stop}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger
          render={<Button size="sm" variant="outline" className="text-destructive" disabled={pending} />}
        >
          <Ban className="size-3.5" aria-hidden />
          {t.stopAndBlock}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.stopAndBlock}</AlertDialogTitle>
            <AlertDialogDescription>{t.stopAndBlockConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => run(stopSendJobAction, { block: "true" }, t.stopAndBlock)}
              disabled={pending}
            >
              {t.stopAndBlock}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
