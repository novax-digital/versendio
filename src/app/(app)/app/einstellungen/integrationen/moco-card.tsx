"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  connectMocoAction,
  disconnectMocoAction,
  syncMocoNowAction,
  updateMocoRulesAction,
} from "./actions";

export type MocoAccountView = {
  subdomain: string;
  status: string;
  lastError: string | null;
  lastSyncAt: string | null;
  autoInvoices: boolean;
  invoiceTrigger: "created" | "sent";
  autoReminders: boolean;
  duplex: boolean;
  color: boolean;
};

export type MocoDocumentView = {
  id: string;
  docType: string;
  identifier: string | null;
  title: string | null;
  status: string;
  detail: string | null;
  createdAt: string;
  sendJobId: string | null;
};

const t = de.integrations;

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });

/** Sync detail codes carry a technical suffix ("pdf_invalid: …") — map the
 *  prefix to German; unknown codes fall back to a generic label. */
function detailLabel(detail: string | null): string | null {
  if (!detail || detail === "processing") return null;
  const key = detail.split(":")[0].trim();
  return t.mocoDocDetail[key] ?? t.mocoDocDetail.unknown_error;
}

export function MocoCard({
  account,
  documents,
}: {
  account: MocoAccountView | null;
  documents: MocoDocumentView[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-base">
          <Image
            src="/integrationen/logo_moco.svg"
            alt={t.mocoTitle}
            width={88}
            height={22}
            className="h-5 w-auto dark:invert"
          />
          {account ? (
            account.status === "active" ? (
              <Badge variant="secondary">{t.mocoConnected}</Badge>
            ) : (
              <Badge variant="destructive">{t.mocoConnectionErrorBadge}</Badge>
            )
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-muted-foreground text-sm">{t.mocoHint}</p>
        {account ? <ConnectedView account={account} documents={documents} /> : <ConnectForm />}
      </CardContent>
    </Card>
  );
}

function ConnectForm({ defaultSubdomain }: { defaultSubdomain?: string }) {
  const [state, formAction, pending] = useActionState(connectMocoAction, null);

  useEffect(() => {
    if (state && !state.ok && state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="moco-subdomain">{t.mocoSubdomain}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="moco-subdomain"
            name="subdomain"
            placeholder={t.mocoSubdomainPlaceholder}
            defaultValue={defaultSubdomain}
            required
            autoComplete="off"
            className="max-w-48"
          />
          <span className="text-muted-foreground text-sm">{t.mocoSubdomainSuffix}</span>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="moco-key">{t.mocoApiKey}</Label>
        <Input id="moco-key" name="apiKey" type="password" required autoComplete="off" />
        <p className="text-muted-foreground text-xs">{t.mocoApiKeyHint}</p>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? de.common.loading : t.mocoConnect}
      </Button>
    </form>
  );
}

function ConnectedView({
  account,
  documents,
}: {
  account: MocoAccountView;
  documents: MocoDocumentView[];
}) {
  const initial = {
    autoInvoices: account.autoInvoices,
    invoiceTrigger: account.invoiceTrigger,
    autoReminders: account.autoReminders,
    duplex: account.duplex,
    color: account.color,
  };
  const [rules, setRules] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [syncing, startSync] = useTransition();

  // Unsaved switches must not silently diverge from what a sync would use —
  // the sync runs against the SAVED server rules.
  const dirty =
    rules.autoInvoices !== initial.autoInvoices ||
    rules.invoiceTrigger !== initial.invoiceTrigger ||
    rules.autoReminders !== initial.autoReminders ||
    rules.duplex !== initial.duplex ||
    rules.color !== initial.color;

  const save = () => {
    const fd = new FormData();
    fd.set("autoInvoices", rules.autoInvoices ? "true" : "false");
    fd.set("invoiceTrigger", rules.invoiceTrigger);
    fd.set("autoReminders", rules.autoReminders ? "true" : "false");
    fd.set("duplex", rules.duplex ? "true" : "false");
    fd.set("color", rules.color ? "true" : "false");
    startTransition(async () => {
      const result = await updateMocoRulesAction(null, fd);
      if (result.ok) toast.success(t.mocoSaved);
      else toast.error(result.error);
    });
  };

  const syncNow = () => {
    if (!account.autoInvoices && !account.autoReminders) {
      toast.info(t.mocoSyncNoRules);
      return;
    }
    startSync(async () => {
      const result = await syncMocoNowAction();
      if (!result.ok || !result.data) {
        toast.error(!result.ok ? result.error : de.common.genericError);
        return;
      }
      const { sent, failed, insufficientFunds } = result.data;
      if (insufficientFunds > 0) toast.warning(t.mocoSyncFunds);
      if (sent + failed + insufficientFunds === 0) toast.info(t.mocoSyncNothingNew);
      else toast.success(t.mocoSyncResult(sent, failed));
    });
  };

  const disconnect = () => {
    startTransition(async () => {
      const result = await disconnectMocoAction();
      if (result.ok) toast.success(t.mocoDisconnected);
      else toast.error(result.error);
    });
  };

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <p>
          {t.mocoConnectedAs}{" "}
          <span className="font-medium">
            {account.subdomain}
            {t.mocoSubdomainSuffix}
          </span>
        </p>
        <p className="text-muted-foreground">
          {t.mocoLastSync}:{" "}
          {account.lastSyncAt ? dateFormat.format(new Date(account.lastSyncAt)) : t.mocoNeverSynced}
        </p>
      </div>

      {account.status !== "active" ? (
        // Broken credentials: offer re-entry in place — rules survive.
        <div className="space-y-4 rounded-md border border-dashed p-4">
          <p className="text-destructive text-sm">{t.mocoReconnectHint}</p>
          <ConnectForm defaultSubdomain={account.subdomain} />
        </div>
      ) : null}

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">{t.mocoRulesTitle}</h3>
          <p className="text-muted-foreground text-sm">{t.mocoRulesHint}</p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="moco-inv">{t.mocoAutoInvoices}</Label>
            <p className="text-muted-foreground text-sm">{t.mocoAutoInvoicesHint}</p>
          </div>
          <Switch
            id="moco-inv"
            checked={rules.autoInvoices}
            onCheckedChange={(v) => setRules((r) => ({ ...r, autoInvoices: v === true }))}
          />
        </div>

        {rules.autoInvoices ? (
          <div className="space-y-1.5">
            <Label htmlFor="moco-trigger">{t.mocoTriggerLabel}</Label>
            <select
              id="moco-trigger"
              value={rules.invoiceTrigger}
              onChange={(e) =>
                setRules((r) => ({ ...r, invoiceTrigger: e.target.value as "created" | "sent" }))
              }
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            >
              <option value="created">{t.mocoTriggerCreated}</option>
              <option value="sent">{t.mocoTriggerSent}</option>
            </select>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="moco-rem">{t.mocoAutoReminders}</Label>
            <p className="text-muted-foreground text-sm">{t.mocoAutoRemindersHint}</p>
          </div>
          <Switch
            id="moco-rem"
            checked={rules.autoReminders}
            onCheckedChange={(v) => setRules((r) => ({ ...r, autoReminders: v === true }))}
          />
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={rules.duplex}
              onCheckedChange={(v) => setRules((r) => ({ ...r, duplex: v === true }))}
            />
            {t.mocoOptionDuplex}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={rules.color}
              onCheckedChange={(v) => setRules((r) => ({ ...r, color: v === true }))}
            />
            {t.mocoOptionColor}
          </label>
        </div>

        <p className="text-muted-foreground text-xs">{t.mocoPartnerNote}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={pending}>
            {pending ? de.common.saving : de.common.save}
          </Button>
          <Button variant="outline" onClick={syncNow} disabled={syncing || dirty}>
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} aria-hidden />
            {t.mocoSyncNow}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" className="text-destructive" />}>
              {t.mocoDisconnect}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t.mocoDisconnect}</AlertDialogTitle>
                <AlertDialogDescription>{t.mocoDisconnectConfirm}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={disconnect}>{t.mocoDisconnect}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {dirty ? <p className="text-muted-foreground text-xs">{t.mocoSyncSaveFirst}</p> : null}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t.mocoActivityTitle}</h3>
        {documents.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.mocoActivityEmpty}</p>
        ) : (
          <ul className="divide-y text-sm">
            {documents.map((doc) => {
              const label = detailLabel(doc.detail);
              return (
                <li key={doc.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {doc.docType === "invoice" ? t.mocoDocInvoice : t.mocoDocReminder}{" "}
                      {doc.identifier ?? ""}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {dateFormat.format(new Date(doc.createdAt))}
                      {doc.status !== "sent" && label ? ` · ${label}` : ""}
                    </p>
                  </div>
                  <Badge
                    variant={
                      doc.status === "sent"
                        ? "secondary"
                        : doc.status === "failed"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {t.mocoDocStatus[doc.status] ?? doc.status}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
