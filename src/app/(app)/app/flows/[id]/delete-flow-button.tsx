"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { deleteFlowAction } from "../actions";
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

export function DeleteFlowButton({ flowId }: { flowId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const remove = () => {
    const fd = new FormData();
    fd.set("id", flowId);
    startTransition(async () => {
      const result = await deleteFlowAction(null, fd);
      if (result.ok) {
        toast.success(de.flows.deleted);
        router.push("/app/flows");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" className="text-destructive" />}>
        <Trash2 className="size-4" aria-hidden />
        {de.flows.delete}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{de.flows.deleteConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{de.flows.deleteConfirmBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={remove} disabled={pending}>
            {de.flows.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
