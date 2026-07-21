"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  deleteWlCustomerAction,
  toggleWlCustomerAction,
  upsertWlCustomerAction,
} from "./actions";
import type { WlCustomerWithUsage } from "@/lib/server/whitelabel/queries";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormField } from "@/components/forms/form-field";
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";

export function CustomersTable({ customers }: { customers: WlCustomerWithUsage[] }) {
  const [editing, setEditing] = useState<WlCustomerWithUsage | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<WlCustomerWithUsage | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{de.whitelabel.customersTitle}</h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          {de.whitelabel.addCustomer}
        </Button>
      </div>

      {customers.length === 0 ? (
        <p className="text-muted-foreground rounded-md border py-10 text-center text-sm">
          {de.whitelabel.empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{de.whitelabel.colName}</TableHead>
                <TableHead className="text-right">{de.whitelabel.colLettersMonth}</TableHead>
                <TableHead className="text-right">{de.whitelabel.colCostMonth}</TableHead>
                <TableHead className="text-right">{de.whitelabel.colLettersTotal}</TableHead>
                <TableHead className="text-right">{de.whitelabel.colCostTotal}</TableHead>
                <TableHead>{de.whitelabel.colActive}</TableHead>
                <TableHead className="w-20 text-right">{de.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/app/whitelabel/${c.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.external_ref ? (
                      <span className="text-muted-foreground block text-xs">
                        {de.whitelabel.externalRefShort}: {c.external_ref}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.month.lettersSent}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(c.month.costCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.total.lettersSent}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(c.total.costCents)}
                  </TableCell>
                  <TableCell>
                    <CustomerToggle customer={c} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={de.common.edit}
                        onClick={() => setEditing(c)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        aria-label={de.common.delete}
                        disabled={c.total.lettersSent > 0}
                        title={c.total.lettersSent > 0 ? de.whitelabel.deleteHasSends : undefined}
                        onClick={() => setDeleting(c)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CustomerDialog
        key={editing?.id ?? (creating ? "new" : "closed")}
        open={creating || editing !== null}
        customer={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
      <DeleteCustomerDialog customer={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function CustomerToggle({ customer }: { customer: WlCustomerWithUsage }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const toggle = (next: boolean) => {
    const fd = new FormData();
    fd.set("id", customer.id);
    fd.set("active", next ? "true" : "false");
    setPending(true);
    void toggleWlCustomerAction(null, fd).then((result) => {
      setPending(false);
      if (result.ok) router.refresh();
      else toast.error(result.error);
    });
  };

  return (
    <Switch
      checked={customer.is_active}
      onCheckedChange={toggle}
      disabled={pending}
      aria-label={customer.is_active ? de.whitelabel.deactivate : de.whitelabel.activate}
    />
  );
}

function CustomerDialog({
  open,
  customer,
  onClose,
}: {
  open: boolean;
  customer: WlCustomerWithUsage | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(upsertWlCustomerAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) {
      toast.success(de.whitelabel.saved);
      router.refresh();
      onClose();
    } else if (state && !state.ok && state.error) {
      toast.error(state.error);
    }
  }, [state, onClose, router]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {customer ? de.whitelabel.editCustomer : de.whitelabel.addCustomer}
          </DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          {customer ? <input type="hidden" name="id" value={customer.id} /> : null}
          <FormField
            label={de.whitelabel.fieldName}
            name="name"
            defaultValue={customer?.name ?? ""}
            required
            error={fieldErrors?.name}
          />
          <FormField
            label={de.whitelabel.fieldExternalRef}
            name="externalRef"
            defaultValue={customer?.external_ref ?? ""}
            optionalLabel={de.common.optional}
            hint={de.whitelabel.fieldExternalRefHint}
            error={fieldErrors?.externalRef}
          />
          <FormField
            label={de.contacts.email}
            name="email"
            type="email"
            defaultValue={customer?.email ?? ""}
            optionalLabel={de.common.optional}
            error={fieldErrors?.email}
          />
          <FormField
            label={de.whitelabel.fieldNotes}
            name="notes"
            defaultValue={customer?.notes ?? ""}
            optionalLabel={de.common.optional}
            error={fieldErrors?.notes}
          />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? de.common.saving : de.common.save}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCustomerDialog({
  customer,
  onClose,
}: {
  customer: WlCustomerWithUsage | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(deleteWlCustomerAction, null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(de.whitelabel.deleted);
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
    onClose();
  }, [state, onClose, router]);

  return (
    <AlertDialog open={customer !== null} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{de.whitelabel.deleteTitle}</AlertDialogTitle>
          <AlertDialogDescription>{de.whitelabel.deleteConfirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
          <form action={formAction}>
            <input type="hidden" name="id" value={customer?.id ?? ""} />
            <AlertDialogAction type="submit" disabled={pending}>
              {de.common.delete}
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
