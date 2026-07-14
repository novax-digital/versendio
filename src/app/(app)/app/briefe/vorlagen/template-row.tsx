"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { LayoutTemplate, FilePlus2, Pencil, MoreVertical, Trash2 } from "lucide-react";
import { deleteTemplateAction } from "../actions";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui-ext/button-link";
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
 * A template list row: create a letter from it, edit it, or delete it. Delete
 * uses a controlled AlertDialog rendered as a SIBLING of the menu (base-ui
 * unmounts a dialog nested inside a closing DropdownMenuItem).
 * deleteTemplateAction revalidates /app/briefe/vorlagen, so the row disappears
 * on success — no client navigation needed.
 */
export function TemplateRow({
  id,
  name,
  updatedLabel,
}: {
  id: string;
  name: string;
  updatedLabel: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [state, formAction, pending] = useActionState(deleteTemplateAction, null);

  useEffect(() => {
    if (!state) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmOpen(false);
    if (state.ok) toast.success(de.letters.templateDeleted);
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <li className="hover:bg-muted/50 flex items-center gap-2 px-4 py-3 transition-colors sm:gap-3">
      <LayoutTemplate className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        <p className="text-muted-foreground text-xs">
          {de.letters.templateColUpdated}: {updatedLabel}
        </p>
      </div>

      <ButtonLink href={`/app/briefe/editor?vorlage=${id}`} size="sm" className="shrink-0">
        <FilePlus2 className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">{de.letters.templateCreateLetter}</span>
      </ButtonLink>
      <ButtonLink
        href={`/app/briefe/vorlagen/${id}/bearbeiten`}
        variant="outline"
        size="sm"
        className="shrink-0"
      >
        <Pencil className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">{de.letters.templateEdit}</span>
      </ButtonLink>

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
            {de.letters.templateDelete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{de.letters.templateDelete}</AlertDialogTitle>
            <AlertDialogDescription>{de.letters.templateDeleteConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
            <form action={formAction}>
              <input type="hidden" name="id" value={id} />
              <AlertDialogAction type="submit" disabled={pending}>
                {de.common.delete}
              </AlertDialogAction>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
