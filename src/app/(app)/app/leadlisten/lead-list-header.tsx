"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { upsertLeadListAction } from "./actions";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { de } from "@/lib/i18n/de";

export function LeadListHeader() {
  const [open, setOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>();
  const [pending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await upsertLeadListAction(null, formData);
      if (result.ok) {
        toast.success(de.leadLists.saved);
        setFieldErrors(undefined);
        setOpen(false);
      } else {
        setFieldErrors(result.fieldErrors);
        if (result.error) toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{de.leadLists.title}</h1>
        <p className="text-muted-foreground text-sm">{de.leadLists.subtitle}</p>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button />}>
          <Plus className="size-4" aria-hidden />
          {de.leadLists.addButton}
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{de.leadLists.addButton}</DialogTitle>
          </DialogHeader>
          <form action={submit} className="space-y-4" noValidate>
            <FormField label={de.leadLists.name} name="name" required error={fieldErrors?.name} />
            <FormField
              label={de.leadLists.description}
              name="description"
              optionalLabel={de.common.optional}
              error={fieldErrors?.description}
            />
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? de.common.saving : de.common.save}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
