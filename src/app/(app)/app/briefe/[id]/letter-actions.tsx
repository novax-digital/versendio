"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { deleteLetterAction, setCoverLetterAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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

export function LetterActions({ letterId }: { letterId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(deleteLetterAction, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(de.letters.deleted);
      router.push("/app/briefe");
    } else if (state && !state.ok && state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" className="text-destructive" />}>
        <Trash2 className="size-4" aria-hidden />
        {de.common.delete}
      </AlertDialogTrigger>
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
  );
}

function CoverToggle({
  letterId,
  useCover,
  recommended,
}: {
  letterId: string;
  useCover: boolean;
  recommended: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(useCover);
  const [pending, startTransition] = useTransition();

  const onToggle = (value: boolean) => {
    setChecked(value);
    const fd = new FormData();
    fd.set("id", letterId);
    fd.set("use", value ? "true" : "false");
    startTransition(async () => {
      const result = await setCoverLetterAction(null, fd);
      if (result.ok) {
        router.refresh();
      } else {
        toast.error(result.error);
        // Revert the optimistic toggle so the UI matches the persisted state.
        setChecked(!value);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {de.letters.coverLetter}
          {recommended ? <Badge variant="secondary">{de.letters.recommendedBadge}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">{de.letters.coverLetterHint}</p>
        <div className="flex items-center gap-2">
          <Switch id="cover" checked={checked} disabled={pending} onCheckedChange={onToggle} />
          <Label htmlFor="cover" className="font-normal">
            {de.letters.coverLetter}
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}

LetterActions.CoverToggle = CoverToggle;
