"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { deletePlanAction, upsertPlanAction } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { de } from "@/lib/i18n/de";

export type Plan = {
  id: string;
  name: string;
  discount_percent: number;
  is_default: boolean;
};

export function ConditionsTable({ plans }: { plans: Plan[] }) {
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Plan | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{de.admin.conditionsTitle}</h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          {de.admin.addCondition}
        </Button>
      </div>
      <p className="text-muted-foreground max-w-3xl text-sm">{de.admin.conditionsHint}</p>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{de.admin.conditionName}</TableHead>
              <TableHead className="text-right">{de.admin.conditionDiscount}</TableHead>
              <TableHead className="w-24 text-right">{de.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell className="font-medium">
                  {plan.name}
                  {plan.is_default ? (
                    <Badge variant="outline" className="ml-2">
                      {de.admin.conditionDefaultBadge}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{plan.discount_percent} %</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={de.common.edit}
                      onClick={() => setEditing(plan)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive"
                      aria-label={de.common.delete}
                      disabled={plan.is_default}
                      onClick={() => setDeleting(plan)}
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

      <ConditionDialog
        key={editing?.id ?? (creating ? "new" : "closed")}
        open={creating || editing !== null}
        plan={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <DeleteConditionDialog plan={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function ConditionDialog({
  open,
  plan,
  onClose,
}: {
  open: boolean;
  plan: Plan | null;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(upsertPlanAction, null);
  const [isDefault, setIsDefault] = useState(plan?.is_default ?? false);

  useEffect(() => {
    if (state?.ok) {
      toast.success(de.admin.conditionSaved);
      onClose();
    } else if (state && !state.ok && state.error) {
      toast.error(state.error);
    }
  }, [state, onClose]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{plan ? de.admin.editCondition : de.admin.addCondition}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" key={plan?.id ?? "new"}>
          {plan ? <input type="hidden" name="id" value={plan.id} /> : null}
          <input type="hidden" name="isDefault" value={isDefault ? "true" : "false"} />
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">{de.admin.conditionName}</Label>
            <Input id="plan-name" name="name" defaultValue={plan?.name ?? ""} required maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-discount">{de.admin.conditionDiscount}</Label>
            <Input
              id="plan-discount"
              name="discountPercent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={plan?.discount_percent ?? 0}
              required
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="plan-default" checked={isDefault} onCheckedChange={setIsDefault} />
            <Label htmlFor="plan-default" className="font-normal">
              {de.admin.conditionDefault}
            </Label>
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? de.common.saving : de.common.save}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConditionDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(deletePlanAction, null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(de.admin.conditionDeleted);
    else if (state.error) toast.error(state.error);
    onClose();
  }, [state, onClose]);

  return (
    <AlertDialog open={plan !== null} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{de.admin.editCondition}</AlertDialogTitle>
          <AlertDialogDescription>{de.admin.deleteConditionConfirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
          <form action={formAction}>
            <input type="hidden" name="id" value={plan?.id ?? ""} />
            <AlertDialogAction type="submit" disabled={pending}>
              {de.common.delete}
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
