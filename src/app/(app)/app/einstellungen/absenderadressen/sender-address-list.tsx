"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { MapPin, Plus, Star, Trash2, Pencil } from "lucide-react";
import {
  deleteSenderAddressAction,
  setDefaultSenderAddressAction,
  upsertSenderAddressAction,
} from "../actions";
import { FormField } from "@/components/forms/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { buildSenderLine } from "@/lib/shared/schemas/profile";
import { de } from "@/lib/i18n/de";

export type SenderAddress = {
  id: string;
  label: string;
  company: string | null;
  first_name: string | null;
  last_name: string | null;
  street: string;
  zip: string;
  city: string;
  country: string;
  sender_line: string;
  is_default: boolean;
};

export function SenderAddressList({ addresses }: { addresses: SenderAddress[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SenderAddress | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (address: SenderAddress) => {
    setEditing(address);
    setDialogOpen(true);
  };
  // Stable so the form's save-effect only fires on state change, never on re-render.
  const handleSaved = useCallback(() => setDialogOpen(false), []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button onClick={openCreate} />}>
            <Plus className="size-4" aria-hidden />
            {de.senderAddresses.addButton}
          </DialogTrigger>
          <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editing ? de.senderAddresses.editTitle : de.senderAddresses.addButton}
              </DialogTitle>
            </DialogHeader>
            <SenderAddressForm
              key={editing?.id ?? "new"}
              address={editing}
              onSaved={handleSaved}
              forceDefault={addresses.length === 0}
            />
          </DialogContent>
        </Dialog>
      </div>

      {addresses.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm">
            <MapPin className="size-8" aria-hidden />
            <p className="text-foreground font-medium">{de.senderAddresses.empty}</p>
            <p>{de.senderAddresses.emptyCta}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {addresses.map((address) => (
            <li key={address.id}>
              <AddressCard address={address} onEdit={() => openEdit(address)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddressCard({ address, onEdit }: { address: SenderAddress; onEdit: () => void }) {
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteSenderAddressAction,
    null,
  );
  const [defaultState, defaultAction, defaultPending] = useActionState(
    setDefaultSenderAddressAction,
    null,
  );

  useEffect(() => {
    if (deleteState?.ok) toast.success(de.senderAddresses.deleted);
    else if (deleteState && !deleteState.ok && deleteState.error) toast.error(deleteState.error);
  }, [deleteState]);
  useEffect(() => {
    if (defaultState && !defaultState.ok && defaultState.error) toast.error(defaultState.error);
  }, [defaultState]);

  const name =
    address.company || [address.first_name, address.last_name].filter(Boolean).join(" ");

  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 font-medium">
              {address.label}
              {address.is_default ? (
                <Badge variant="secondary">{de.senderAddresses.defaultBadge}</Badge>
              ) : null}
            </p>
            <p className="text-muted-foreground text-sm">
              {name}
              <br />
              {address.street}
              <br />
              {address.zip} {address.city}
              {address.country !== "DE" ? `, ${address.country}` : ""}
            </p>
          </div>
        </div>
        <p className="text-muted-foreground truncate font-mono text-xs" title={address.sender_line}>
          {address.sender_line}
        </p>
        <div className="flex gap-1 pt-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="size-3.5" aria-hidden />
            {de.common.edit}
          </Button>
          {!address.is_default ? (
            <form action={defaultAction}>
              <input type="hidden" name="id" value={address.id} />
              <Button variant="ghost" size="sm" type="submit" disabled={defaultPending}>
                <Star className="size-3.5" aria-hidden />
                {de.senderAddresses.isDefault}
              </Button>
            </form>
          ) : null}
          {!address.is_default ? (
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button variant="ghost" size="sm" className="text-destructive" />}
              >
                <Trash2 className="size-3.5" aria-hidden />
                {de.common.delete}
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{de.common.delete}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {de.senderAddresses.deleteConfirm}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
                  <form action={deleteAction}>
                    <input type="hidden" name="id" value={address.id} />
                    <AlertDialogAction type="submit" disabled={deletePending}>
                      {de.common.delete}
                    </AlertDialogAction>
                  </form>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function SenderAddressForm({
  address,
  onSaved,
  forceDefault,
}: {
  address: SenderAddress | null;
  onSaved: () => void;
  forceDefault: boolean;
}) {
  const [state, formAction, pending] = useActionState(upsertSenderAddressAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  const [fields, setFields] = useState({
    company: address?.company ?? "",
    firstName: address?.first_name ?? "",
    lastName: address?.last_name ?? "",
    street: address?.street ?? "",
    zip: address?.zip ?? "",
    city: address?.city ?? "",
  });
  // Auto-derived until the user edits the line manually — then their value wins.
  const [manualSenderLine, setManualSenderLine] = useState<string | null>(
    address?.sender_line ?? null,
  );
  const senderLine = manualSenderLine ?? buildSenderLine(fields);

  useEffect(() => {
    if (state?.ok) {
      toast.success(de.senderAddresses.saved);
      onSaved();
    } else if (state && !state.ok && state.error) {
      toast.error(state.error);
    }
  }, [state, onSaved]);

  const update = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {address ? <input type="hidden" name="id" value={address.id} /> : null}
      <FormField
        label={de.senderAddresses.label}
        name="label"
        placeholder={de.senderAddresses.labelPlaceholder}
        defaultValue={address?.label ?? ""}
        required
        error={fieldErrors?.label}
      />
      <FormField
        label={de.senderAddresses.companyName}
        name="company"
        value={fields.company}
        onChange={update("company")}
        optionalLabel={de.common.optional}
        error={fieldErrors?.company}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label={de.senderAddresses.firstName}
          name="firstName"
          value={fields.firstName}
          onChange={update("firstName")}
          optionalLabel={de.common.optional}
          error={fieldErrors?.firstName}
        />
        <FormField
          label={de.senderAddresses.lastName}
          name="lastName"
          value={fields.lastName}
          onChange={update("lastName")}
          optionalLabel={de.common.optional}
          error={fieldErrors?.lastName}
        />
      </div>
      <FormField
        label={de.profile.street}
        name="street"
        value={fields.street}
        onChange={update("street")}
        required
        error={fieldErrors?.street}
      />
      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <FormField
          label={de.profile.zip}
          name="zip"
          value={fields.zip}
          onChange={update("zip")}
          required
          error={fieldErrors?.zip}
        />
        <FormField
          label={de.profile.city}
          name="city"
          value={fields.city}
          onChange={update("city")}
          required
          error={fieldErrors?.city}
        />
      </div>
      <FormField
        label={de.profile.country}
        name="country"
        defaultValue={address?.country ?? "DE"}
        maxLength={2}
        hint={de.profile.countryHint}
        error={fieldErrors?.country}
      />
      <FormField
        label={de.senderAddresses.senderLine}
        name="senderLine"
        value={senderLine}
        onChange={(e) => setManualSenderLine(e.target.value)}
        hint={de.senderAddresses.senderLineHint}
        required
        error={fieldErrors?.senderLine}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id="isDefault"
          name="isDefault"
          defaultChecked={forceDefault || (address?.is_default ?? false)}
          disabled={forceDefault || address?.is_default}
        />
        {forceDefault || address?.is_default ? (
          <input type="hidden" name="isDefault" value="true" />
        ) : null}
        <Label htmlFor="isDefault" className="font-normal">
          {de.senderAddresses.isDefault}
        </Label>
      </div>
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
