"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { deleteContactAction, upsertContactAction } from "./actions";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export type Contact = {
  id: string;
  salutation: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  street: string;
  address_extra: string | null;
  zip: string;
  city: string;
  country: string;
  email: string | null;
};

export function ContactList({
  contacts,
  page,
  totalPages,
  searchTerm,
}: {
  contacts: Contact[];
  page: number;
  totalPages: number;
  searchTerm: string;
}) {
  // Dialog is edit-only here; creating a contact lives in CreateContactButton
  // (page header + empty state) so it is reachable in every list state.
  const [editing, setEditing] = useState<Contact | null>(null);
  const handleSaved = useCallback(() => setEditing(null), []);

  return (
    <div className="space-y-4">
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{de.contacts.editContact}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <ContactForm key={editing.id} contact={editing} onSaved={handleSaved} />
          ) : null}
        </DialogContent>
      </Dialog>

      {contacts.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {de.contacts.noSearchResults}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{de.common.name}</TableHead>
                <TableHead>{de.auth.company}</TableHead>
                <TableHead>{de.profile.city}</TableHead>
                <TableHead className="w-24 text-right">{de.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="font-medium">
                    {[contact.first_name, contact.last_name].filter(Boolean).join(" ") || "–"}
                  </TableCell>
                  <TableCell>{contact.company ?? "–"}</TableCell>
                  <TableCell>
                    {contact.zip} {contact.city}
                    {contact.country !== "DE" ? ` (${contact.country})` : ""}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={de.common.edit}
                        onClick={() => setEditing(contact)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <DeleteContactButton contactId={contact.id} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-2 text-sm" aria-label={de.common.pages}>
          {page > 1 ? (
            <Link
              className="underline underline-offset-4"
              href={`/app/kontakte?${new URLSearchParams({ ...(searchTerm ? { q: searchTerm } : {}), seite: String(page - 1) })}`}
            >
              {de.common.back}
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              className="underline underline-offset-4"
              href={`/app/kontakte?${new URLSearchParams({ ...(searchTerm ? { q: searchTerm } : {}), seite: String(page + 1) })}`}
            >
              {de.common.next}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function DeleteContactButton({ contactId }: { contactId: string }) {
  const [state, formAction, pending] = useActionState(deleteContactAction, null);

  useEffect(() => {
    if (state?.ok) toast.success(de.contacts.deleted);
    else if (state && !state.ok && state.error) toast.error(state.error);
  }, [state]);

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive"
            aria-label={de.common.delete}
          />
        }
      >
        <Trash2 className="size-3.5" />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{de.common.delete}</AlertDialogTitle>
          <AlertDialogDescription>{de.contacts.deleteConfirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
          <form action={formAction}>
            <input type="hidden" name="id" value={contactId} />
            <AlertDialogAction type="submit" disabled={pending}>
              {de.common.delete}
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ContactForm({
  contact,
  onSaved,
}: {
  contact: Contact | null;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(upsertContactAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) {
      toast.success(de.contacts.saved);
      onSaved();
    } else if (state && !state.ok && state.error) {
      toast.error(state.error);
    }
  }, [state, onSaved]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {contact ? <input type="hidden" name="id" value={contact.id} /> : null}
      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <FormField
          label={de.contacts.salutation}
          name="salutation"
          defaultValue={contact?.salutation ?? ""}
          optionalLabel={de.common.optional}
          error={fieldErrors?.salutation}
        />
        <FormField
          label={de.contacts.email}
          name="email"
          type="email"
          defaultValue={contact?.email ?? ""}
          optionalLabel={de.common.optional}
          error={fieldErrors?.email}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label={de.senderAddresses.firstName}
          name="firstName"
          defaultValue={contact?.first_name ?? ""}
          optionalLabel={de.common.optional}
          error={fieldErrors?.firstName}
        />
        <FormField
          label={de.senderAddresses.lastName}
          name="lastName"
          defaultValue={contact?.last_name ?? ""}
          error={fieldErrors?.lastName}
        />
      </div>
      <FormField
        label={de.auth.company}
        name="company"
        defaultValue={contact?.company ?? ""}
        optionalLabel={de.common.optional}
        error={fieldErrors?.company}
      />
      <FormField
        label={de.profile.street}
        name="street"
        defaultValue={contact?.street ?? ""}
        required
        error={fieldErrors?.street}
      />
      <FormField
        label={de.contacts.addressExtra}
        name="addressExtra"
        defaultValue={contact?.address_extra ?? ""}
        optionalLabel={de.common.optional}
        error={fieldErrors?.addressExtra}
      />
      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <FormField
          label={de.profile.zip}
          name="zip"
          defaultValue={contact?.zip ?? ""}
          required
          error={fieldErrors?.zip}
        />
        <FormField
          label={de.profile.city}
          name="city"
          defaultValue={contact?.city ?? ""}
          required
          error={fieldErrors?.city}
        />
      </div>
      <FormField
        label={de.profile.country}
        name="country"
        defaultValue={contact?.country ?? "DE"}
        maxLength={2}
        hint={de.profile.countryHint}
        error={fieldErrors?.country}
      />
      {state && !state.ok && state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? de.common.saving : de.common.save}
      </Button>
    </form>
  );
}
