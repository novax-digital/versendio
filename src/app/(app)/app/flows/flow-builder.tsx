"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileText, Info } from "lucide-react";
import { upsertFlowAction } from "./actions";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui-ext/button-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DELAY_UNITS, type DelayUnit } from "@/lib/shared/flows";
import { de } from "@/lib/i18n/de";

export type LetterOption = { id: string; title: string; sheet_count: number | null };
export type ListOption = { id: string; name: string };
export type SenderOption = { id: string; label: string; is_default: boolean };
export type RegisteredOption = "einwurf" | "einschreiben" | "rueckschein";

export type MocoFlowTrigger = "invoice" | "reminder" | "customer";

export type FlowInitial = {
  id: string;
  name: string;
  source: "list" | "moco";
  mocoTrigger: MocoFlowTrigger | null;
  mocoInvoiceStatus: "created" | "sent";
  listId: string;
  listName: string;
  letterId: string;
  delayValue: number;
  delayUnit: DelayUnit;
  isColor: boolean;
  isDuplex: boolean;
  registered: "none" | RegisteredOption;
  senderAddressId: string | null;
};

const REGISTERED_LABELS: Record<"none" | RegisteredOption, string> = {
  none: "Kein Einschreiben",
  einwurf: "Einschreiben Einwurf",
  einschreiben: "Einschreiben",
  rueckschein: "Einschreiben Rückschein",
};

export function FlowBuilder({
  initial,
  letters,
  lists,
  senders,
  availableRegistered,
  mocoConnected,
}: {
  initial: FlowInitial | null;
  letters: LetterOption[];
  lists: ListOption[];
  senders: SenderOption[];
  availableRegistered: RegisteredOption[];
  mocoConnected: boolean;
}) {
  const router = useRouter();
  const isEdit = initial !== null;
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState(initial?.name ?? "");
  const [source, setSource] = useState<"list" | "moco">(initial?.source ?? "list");
  const [mocoTrigger, setMocoTrigger] = useState<MocoFlowTrigger>(
    initial?.mocoTrigger ?? "invoice",
  );
  const [mocoInvoiceStatus, setMocoInvoiceStatus] = useState<"created" | "sent">(
    initial?.mocoInvoiceStatus ?? "created",
  );
  const [listMode, setListMode] = useState<"new" | "existing">(isEdit ? "existing" : "new");
  const [listId, setListId] = useState<string>(initial?.listId ?? lists[0]?.id ?? "");
  const [letterId, setLetterId] = useState<string>(initial?.letterId ?? "");
  const [delayValue, setDelayValue] = useState<string>(String(initial?.delayValue ?? 1));
  const [delayUnit, setDelayUnit] = useState<DelayUnit>(initial?.delayUnit ?? "days");
  const [isColor, setIsColor] = useState(initial?.isColor ?? false);
  const [isDuplex, setIsDuplex] = useState(initial?.isDuplex ?? true);
  const [registered, setRegistered] = useState<"none" | RegisteredOption>(() => {
    // Drop a snapshotted option that is no longer offered (e.g. surcharge row
    // deactivated) so the builder can't re-submit an unpriceable value.
    const r = initial?.registered ?? "none";
    return r === "none" || availableRegistered.includes(r) ? r : "none";
  });
  const [senderId, setSenderId] = useState<string>(initial?.senderAddressId ?? "");

  const submit = () => {
    setFieldErrors({});
    startTransition(async () => {
      const result = await upsertFlowAction(null, {
        id: initial?.id,
        name,
        source,
        mocoTrigger: source === "moco" ? mocoTrigger : undefined,
        mocoInvoiceStatus,
        listMode: source === "moco" ? "new" : isEdit ? "existing" : listMode,
        listId:
          source === "moco"
            ? undefined
            : (isEdit ? initial?.listId : listMode === "existing" ? listId : undefined) ||
              undefined,
        letterId,
        delayValue: Number(delayValue.replace(",", ".")),
        delayUnit,
        options: { isColor, isDuplex, registered },
        senderAddressId: senderId || null,
      });
      if (result.ok) {
        toast.success(de.flows.saved);
        router.push("/app/flows");
        router.refresh();
      } else {
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        if (result.error) toast.error(result.error);
      }
    });
  };

  if (letters.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground space-y-3 py-10 text-center text-sm">
          <p>{de.flows.noLetters}</p>
          <ButtonLink href="/app/briefe/neu">{de.letters.newLetter}</ButtonLink>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Name */}
      <Card>
        <CardContent className="space-y-1.5 pt-6">
          <Label htmlFor="flow-name">{de.flows.nameLabel}</Label>
          <Input
            id="flow-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={de.flows.namePlaceholder}
          />
          {fieldErrors.name ? <p className="text-destructive text-xs">{fieldErrors.name}</p> : null}
        </CardContent>
      </Card>

      {/* 1. Source */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.flows.stepSourceTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isEdit ? (
            <p className="text-sm">
              <span className="font-medium">
                {source === "moco" ? de.flows.sourceMocoLabel : de.flows.sourceListLabel}
              </span>
              <span className="text-muted-foreground block text-xs">{de.flows.sourceEditNote}</span>
            </p>
          ) : (
            <RadioGroup
              value={source}
              onValueChange={(v) => setSource(v as "list" | "moco")}
              className="space-y-2"
            >
              <Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal">
                <RadioGroupItem value="list" className="mt-0.5" />
                <span>
                  {de.flows.sourceListLabel}
                  <span className="text-muted-foreground block text-xs">
                    {de.flows.sourceListDesc}
                  </span>
                </span>
              </Label>
              <Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal">
                <RadioGroupItem value="moco" className="mt-0.5" disabled={!mocoConnected} />
                <span>
                  {de.flows.sourceMocoLabel}
                  <span className="text-muted-foreground block text-xs">
                    {mocoConnected ? de.flows.sourceMocoDesc : de.flows.sourceMocoNotConnected}
                  </span>
                </span>
              </Label>
            </RadioGroup>
          )}
        </CardContent>
      </Card>

      {/* 2a. MOCO trigger (source = moco) */}
      {source === "moco" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{de.flows.mocoTriggerTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <RadioGroup
              value={mocoTrigger}
              onValueChange={(v) => setMocoTrigger(v as MocoFlowTrigger)}
              className="space-y-2"
            >
              {(
                [
                  ["invoice", de.flows.mocoTriggerInvoice, de.flows.mocoTriggerInvoiceDesc],
                  ["reminder", de.flows.mocoTriggerReminder, de.flows.mocoTriggerReminderDesc],
                  ["customer", de.flows.mocoTriggerCustomer, de.flows.mocoTriggerCustomerDesc],
                ] as const
              ).map(([value, label, desc]) => (
                <Label
                  key={value}
                  className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal"
                >
                  <RadioGroupItem value={value} className="mt-0.5" />
                  <span>
                    {label}
                    <span className="text-muted-foreground block text-xs">{desc}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
            {mocoTrigger === "invoice" ? (
              <div className="space-y-1.5">
                <Label>{de.flows.mocoInvoiceStatusLabel}</Label>
                <Select
                  value={mocoInvoiceStatus}
                  onValueChange={(v) => setMocoInvoiceStatus(v as "created" | "sent")}
                >
                  <SelectTrigger className="w-72">
                    <SelectValue>
                      {mocoInvoiceStatus === "created"
                        ? de.flows.mocoInvoiceStatusCreated
                        : de.flows.mocoInvoiceStatusSent}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="created">{de.flows.mocoInvoiceStatusCreated}</SelectItem>
                    <SelectItem value="sent">{de.flows.mocoInvoiceStatusSent}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="text-muted-foreground flex items-start gap-2 text-sm">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>{de.flows.mocoEnrollNote}</p>
            </div>
            {fieldErrors.mocoTrigger ? (
              <p className="text-destructive text-xs">{fieldErrors.mocoTrigger}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* 2b. List (source = list) */}
      {source === "list" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{de.flows.stepListTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isEdit ? (
              <p className="text-sm">
                {de.flows.colList}: <span className="font-medium">{initial?.listName}</span>
              </p>
            ) : (
              <>
                <RadioGroup
                  value={listMode}
                  onValueChange={(v) => setListMode(v as "new" | "existing")}
                  className="space-y-2"
                >
                  <Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal">
                    <RadioGroupItem value="new" className="mt-0.5" />
                    <span>
                      {de.flows.stepListNew}
                      <span className="text-muted-foreground block text-xs">
                        {de.flows.stepListNewHint}
                      </span>
                    </span>
                  </Label>
                  <Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal">
                    <RadioGroupItem
                      value="existing"
                      className="mt-0.5"
                      disabled={lists.length === 0}
                    />
                    <span>{de.flows.stepListExisting}</span>
                  </Label>
                </RadioGroup>
                {listMode === "existing" && lists.length > 0 ? (
                  <div className="space-y-1.5">
                    <Label>{de.flows.stepListSelect}</Label>
                    <Select value={listId} onValueChange={(v) => setListId(v ?? "")}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{lists.find((l) => l.id === listId)?.name ?? ""}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {lists.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldErrors.listId ? (
                      <p className="text-destructive text-xs">{fieldErrors.listId}</p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* 3. Timing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.flows.stepTimingTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-muted-foreground text-sm">{de.flows.stepTimingHint}</p>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="flow-delay">{de.flows.delayValueLabel}</Label>
              <Input
                id="flow-delay"
                type="number"
                min={0}
                inputMode="numeric"
                value={delayValue}
                onChange={(e) => setDelayValue(e.target.value)}
                className="w-28"
              />
            </div>
            <Select value={delayUnit} onValueChange={(v) => setDelayUnit(v as DelayUnit)}>
              <SelectTrigger className="w-36">
                <SelectValue>
                  {delayUnit === "hours" ? de.flows.unitHours : de.flows.unitDays}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DELAY_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u === "hours" ? de.flows.unitHours : de.flows.unitDays}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {fieldErrors.delayValue ? (
            <p className="text-destructive text-xs">{fieldErrors.delayValue}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* 4. Letter + options */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.flows.stepLetterTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{de.flows.stepLetterSelect}</Label>
            <RadioGroup value={letterId} onValueChange={setLetterId} className="space-y-2">
              {letters.map((letter) => (
                <Label
                  key={letter.id}
                  className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-md border p-3 font-normal"
                >
                  <RadioGroupItem value={letter.id} />
                  <FileText className="text-muted-foreground size-4" aria-hidden />
                  <span className="flex-1">
                    {letter.title}
                    {letter.sheet_count ? (
                      <span className="text-muted-foreground block text-xs">
                        {letter.sheet_count} {de.letters.sheetCount}
                      </span>
                    ) : null}
                  </span>
                </Label>
              ))}
            </RadioGroup>
            {fieldErrors.letterId ? (
              <p className="text-destructive text-xs">{fieldErrors.letterId}</p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="flow-color">{de.send.colorLabel}</Label>
            <Switch id="flow-color" checked={isColor} onCheckedChange={setIsColor} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="flow-duplex">{de.send.duplexLabel}</Label>
            <Switch id="flow-duplex" checked={isDuplex} onCheckedChange={setIsDuplex} />
          </div>

          {availableRegistered.length > 0 ? (
            <div className="space-y-1.5">
              <Label>{de.send.registeredLabel}</Label>
              <Select
                value={registered}
                onValueChange={(v) => setRegistered(v as "none" | RegisteredOption)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{REGISTERED_LABELS[registered]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{REGISTERED_LABELS.none}</SelectItem>
                  {availableRegistered.map((r) => (
                    <SelectItem key={r} value={r}>
                      {REGISTERED_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>{de.flows.senderLabel}</Label>
            <Select
              value={senderId || "__default__"}
              onValueChange={(v) => setSenderId(v && v !== "__default__" ? v : "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {senderId
                    ? senders.find((s) => s.id === senderId)?.label
                    : de.flows.senderDefault}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">{de.flows.senderDefault}</SelectItem>
                {senders.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 5. Activation note */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.flows.stepActivationTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-start gap-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{de.flows.activationChargeHint}</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <ButtonLink href="/app/flows" variant="outline">
          {de.common.cancel}
        </ButtonLink>
        <Button onClick={submit} disabled={pending}>
          {pending ? de.common.saving : de.flows.save}
        </Button>
      </div>
    </div>
  );
}
