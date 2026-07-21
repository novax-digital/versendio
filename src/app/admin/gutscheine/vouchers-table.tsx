"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { createVoucherAction, deleteVoucherAction, toggleVoucherAction } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CopyButton } from "@/components/ui-ext/copy-button";
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
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";

export type VoucherRow = {
  id: string;
  code: string;
  amount_cents: number;
  max_redemptions: number | null;
  redemption_count: number;
  valid_until: string | null;
  is_active: boolean;
  comment: string | null;
  created_at: string;
};

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(iso));

export function VouchersTable({ vouchers }: { vouchers: VoucherRow[] }) {
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<VoucherRow | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          {de.admin.voucherAdd}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{de.admin.voucherCode}</TableHead>
              <TableHead className="text-right">{de.admin.voucherAmount}</TableHead>
              <TableHead className="text-right">{de.admin.voucherRedeemed}</TableHead>
              <TableHead>{de.admin.voucherValidUntil}</TableHead>
              <TableHead>{de.admin.voucherActive}</TableHead>
              <TableHead className="w-16 text-right">{de.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vouchers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-8 text-center text-sm">
                  {de.admin.voucherEmpty}
                </TableCell>
              </TableRow>
            ) : (
              vouchers.map((v) => {
                const expired = v.valid_until !== null && new Date(v.valid_until) < new Date();
                const exhausted =
                  v.max_redemptions !== null && v.redemption_count >= v.max_redemptions;
                return (
                  <TableRow key={v.id}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-sm font-medium">{v.code}</span>
                        <CopyButton value={v.code} />
                      </div>
                      {v.comment ? (
                        <span className="text-muted-foreground block max-w-56 truncate text-xs">
                          {v.comment}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(v.amount_cents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.redemption_count} / {v.max_redemptions ?? "∞"}
                      {exhausted ? (
                        <Badge variant="secondary" className="ml-2">
                          {de.admin.voucherExhausted}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {v.valid_until ? fmtDate(v.valid_until) : de.admin.voucherNoExpiry}
                      {expired ? (
                        <Badge variant="secondary" className="ml-2">
                          {de.admin.voucherExpired}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <VoucherToggle voucher={v} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        aria-label={de.common.delete}
                        disabled={v.redemption_count > 0}
                        title={v.redemption_count > 0 ? de.admin.voucherDeleteRedeemed : undefined}
                        onClick={() => setDeleting(v)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <CreateVoucherDialog
        key={creating ? "open" : "closed"}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <DeleteVoucherDialog voucher={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function VoucherToggle({ voucher }: { voucher: VoucherRow }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const toggle = (next: boolean) => {
    const fd = new FormData();
    fd.set("id", voucher.id);
    fd.set("active", next ? "true" : "false");
    setPending(true);
    void toggleVoucherAction(null, fd).then((result) => {
      setPending(false);
      if (result.ok) router.refresh();
      else toast.error(result.error);
    });
  };

  return (
    <Switch
      checked={voucher.is_active}
      onCheckedChange={toggle}
      disabled={pending}
      aria-label={voucher.is_active ? de.admin.voucherDeactivate : de.admin.voucherActivate}
    />
  );
}

function CreateVoucherDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(createVoucherAction, null);
  const [euro, setEuro] = useState("");

  useEffect(() => {
    if (state?.ok) {
      toast.success(de.admin.voucherCreated(state.data?.code ?? ""));
      onClose();
    } else if (state && !state.ok && state.error) {
      toast.error(state.error);
    }
  }, [state, onClose]);

  const amountCents = Math.round(Number(euro.replace(",", ".")) * 100);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{de.admin.voucherAdd}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input
            type="hidden"
            name="amountCents"
            value={Number.isFinite(amountCents) && amountCents > 0 ? amountCents : ""}
          />
          <div className="space-y-1.5">
            <Label htmlFor="voucher-amount">{de.admin.voucherAmountEuro}</Label>
            <Input
              id="voucher-amount"
              inputMode="decimal"
              value={euro}
              onChange={(e) => setEuro(e.target.value)}
              placeholder="10,00"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="voucher-max">{de.admin.voucherMaxRedemptions}</Label>
            <Input
              id="voucher-max"
              name="maxRedemptions"
              type="number"
              min={1}
              step={1}
              placeholder={de.admin.voucherUnlimited}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="voucher-until">{de.admin.voucherValidUntil}</Label>
            <Input id="voucher-until" name="validUntil" type="date" />
            <p className="text-muted-foreground text-xs">{de.admin.voucherValidUntilHint}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="voucher-code">{de.admin.voucherCode}</Label>
            <Input
              id="voucher-code"
              name="code"
              maxLength={40}
              placeholder={de.admin.voucherCodePlaceholder}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="voucher-comment">{de.admin.voucherComment}</Label>
            <Input id="voucher-comment" name="comment" maxLength={200} />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? de.common.saving : de.admin.voucherCreate}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteVoucherDialog({
  voucher,
  onClose,
}: {
  voucher: VoucherRow | null;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(deleteVoucherAction, null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(de.admin.voucherDeleted);
    else if (state.error) toast.error(state.error);
    onClose();
  }, [state, onClose]);

  return (
    <AlertDialog open={voucher !== null} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{de.admin.voucherDeleteTitle}</AlertDialogTitle>
          <AlertDialogDescription>{de.admin.voucherDeleteConfirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
          <form action={formAction}>
            <input type="hidden" name="id" value={voucher?.id ?? ""} />
            <AlertDialogAction type="submit" disabled={pending}>
              {de.common.delete}
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
