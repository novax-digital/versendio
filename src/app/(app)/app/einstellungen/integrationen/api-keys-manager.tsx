"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function copy(value: string) {
  void navigator.clipboard?.writeText(value).then(() => toast.success(de.integrations.copied));
}

export function ApiKeysManager({ keys }: { keys: ApiKey[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <KeyRound className="text-muted-foreground size-4" aria-hidden />
          {de.integrations.keysTitle}
        </h2>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden />
          {de.integrations.createKey}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">{de.integrations.keysHint}</p>

      {keys.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">{de.integrations.noKeys}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{de.integrations.colName}</TableHead>
                <TableHead>{de.integrations.colKey}</TableHead>
                <TableHead>{de.integrations.colLastUsed}</TableHead>
                <TableHead className="w-20 text-right">{de.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">
                    {k.name}
                    {k.revoked_at ? (
                      <Badge variant="secondary" className="ml-2">
                        {de.integrations.revokedBadge}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{k.key_prefix}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {k.last_used_at
                      ? new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(
                          new Date(k.last_used_at),
                        )
                      : de.integrations.neverUsed}
                  </TableCell>
                  <TableCell className="text-right">
                    {!k.revoked_at ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        aria-label={de.integrations.revoke}
                        onClick={() => setRevoking(k)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateKeyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(key) => {
          setCreateOpen(false);
          setNewKey(key);
        }}
      />

      <Dialog open={newKey !== null} onOpenChange={(o) => !o && setNewKey(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{de.integrations.keyCreatedTitle}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">{de.integrations.keyCreatedHint}</p>
          <div className="flex items-center gap-2">
            <code className="bg-muted block flex-1 overflow-x-auto rounded px-2 py-1.5 font-mono text-xs">
              {newKey}
            </code>
            <Button variant="outline" size="sm" onClick={() => newKey && copy(newKey)}>
              <Copy className="size-3.5" aria-hidden />
              {de.integrations.copy}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <RevokeKeyDialog keyRow={revoking} onClose={() => setRevoking(null)} />
    </section>
  );
}

function CreateKeyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const [state, formAction, pending] = useActionState(createApiKeyAction, null);

  useEffect(() => {
    if (state?.ok && state.data) {
      toast.success(de.integrations.keyCreated);
      onCreated(state.data.key);
    } else if (state && !state.ok && state.error) {
      toast.error(state.error);
    }
  }, [state, onCreated]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{de.integrations.createKey}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" key={open ? "open" : "closed"}>
          <div className="space-y-1.5">
            <Label htmlFor="key-name">{de.integrations.keyNameLabel}</Label>
            <Input
              id="key-name"
              name="name"
              required
              maxLength={60}
              placeholder={de.integrations.keyNamePlaceholder}
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? de.common.saving : de.integrations.createKey}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevokeKeyDialog({ keyRow, onClose }: { keyRow: ApiKey | null; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(revokeApiKeyAction, null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(de.integrations.revoked);
    else if (state.error) toast.error(state.error);
    onClose();
  }, [state, onClose]);

  return (
    <AlertDialog open={keyRow !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{de.integrations.revoke}</AlertDialogTitle>
          <AlertDialogDescription>{de.integrations.revokeConfirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
          <form action={formAction}>
            <input type="hidden" name="id" value={keyRow?.id ?? ""} />
            <AlertDialogAction type="submit" disabled={pending}>
              {de.integrations.revoke}
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
