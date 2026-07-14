"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { MoreVertical, Trash2 } from "lucide-react";
import { deleteLetterAction } from "./actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { de } from "@/lib/i18n/de";

/**
 * Row overflow menu with a delete action. The AlertDialog is controlled and
 * rendered as a SIBLING of the menu (base-ui unmounts a dialog nested inside a
 * closing DropdownMenuItem). deleteLetterAction revalidates /app/briefe, so the
 * row disappears on success — no client navigation needed.
 */
export function LetterRowMenu({ letterId }: { letterId: string }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [state, formAction, pending] = useActionState(deleteLetterAction, null);

  useEffect(() => {
    if (!state) return;
    // Reflect the server-action result into the UI (close dialog + toast).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmOpen(false);
    if (state.ok) toast.success(de.letters.deleted);
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label={de.letters.moreActions}
            />
          }
        >
          <MoreVertical className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="size-4" aria-hidden />
            {de.common.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{de.common.delete}</AlertDialogTitle>
            <AlertDialogDescription>{de.letters.deleteConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
            <form action={formAction}>
              <input type="hidden" name="id" value={letterId} />
              <AlertDialogAction type="submit" disabled={pending}>
                {de.common.delete}
              </AlertDialogAction>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
