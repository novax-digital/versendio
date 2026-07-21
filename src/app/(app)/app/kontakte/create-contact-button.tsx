"use client";

import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ContactForm } from "./contact-list";
import type { ActiveFlowOption } from "@/lib/server/flows/active-flows";
import { de } from "@/lib/i18n/de";

/**
 * Standalone "Kontakt anlegen" button + dialog, reusable in the page header and
 * the empty state so creating a contact is reachable in every list state.
 */
export function CreateContactButton({
  variant,
  activeFlows = [],
}: {
  variant?: "default" | "outline";
  activeFlows?: ActiveFlowOption[];
}) {
  const [open, setOpen] = useState(false);
  // Remount the form on each open so fields reset after a previous save.
  const [formKey, setFormKey] = useState(0);
  const handleSaved = useCallback(() => setOpen(false), []);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setFormKey((k) => k + 1);
      }}
    >
      <DialogTrigger render={<Button variant={variant} />}>
        <Plus className="size-4" aria-hidden />
        {de.contacts.addContact}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{de.contacts.addContact}</DialogTitle>
        </DialogHeader>
        <ContactForm
          key={formKey}
          contact={null}
          onSaved={handleSaved}
          activeFlows={activeFlows}
        />
      </DialogContent>
    </Dialog>
  );
}
