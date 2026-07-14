"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileText, FlaskConical, Users, X } from "lucide-react";
import { quoteSendJobAction, confirmSendJobAction, type QuoteResult } from "./actions";
import { searchContactsAction } from "../leadlisten/[id]/search-contacts-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";
import { ButtonLink } from "@/components/ui-ext/button-link";

type LetterOption = {
  id: string;
  title: string;
  source: string;
  page_count: number | null;
  sheet_count: number | null;
  has_placeholders: boolean;
};
type LeadListOption = { id: string; name: string; count: number };
type SenderOption = { id: string; label: string; is_default: boolean };
type ContactHit = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  city: string;
};

type Registered = "none" | "einwurf" | "einschreiben" | "rueckschein";

const STEPS = [de.send.stepLetter, de.send.stepRecipients, de.send.stepOptions, de.send.stepConfirm];

export function SendWizard({
  letters,
  leadLists,
  senderAddresses,
  preselectedLetterId,
  availableRegistered,
  mockMode,
}: {
  letters: LetterOption[];
  leadLists: LeadListOption[];
  senderAddresses: SenderOption[];
  preselectedLetterId: string | null;
  // Registered-mail options with an active price; empty = feature not offered.
  availableRegistered: Exclude<Registered, "none">[];
  mockMode: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [letterId, setLetterId] = useState<string | null>(
    preselectedLetterId && letters.some((l) => l.id === preselectedLetterId)
      ? preselectedLetterId
      : null,
  );
  const [recipientSource, setRecipientSource] = useState<"lead_list" | "contacts">("lead_list");
  const [leadListId, setLeadListId] = useState<string | null>(leadLists[0]?.id ?? null);
  const [selectedContacts, setSelectedContacts] = useState<ContactHit[]>([]);
  const [isColor, setIsColor] = useState(false);
  const [isDuplex, setIsDuplex] = useState(true);
  const [registered, setRegistered] = useState<Registered>("none");
  const [delayHours, setDelayHours] = useState<number>(0);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  // Separate idempotency tokens: a test run and a real send are different jobs,
  // and reusing one token would make the second silently return the first job.
  const [clientTokens] = useState(() => ({
    real: crypto.randomUUID(),
    test: crypto.randomUUID(),
  }));
  const [pending, startTransition] = useTransition();

  const selectedLetter = letters.find((l) => l.id === letterId) ?? null;

  const recipientSelection = useMemo(
    () =>
      recipientSource === "lead_list"
        ? leadListId
          ? ({ source: "lead_list", leadListId } as const)
          : null
        : selectedContacts.length > 0
          ? ({ source: "contacts", contactIds: selectedContacts.map((c) => c.id) } as const)
          : null,
    [recipientSource, leadListId, selectedContacts],
  );

  const canNext =
    step === 0 ? !!letterId : step === 1 ? !!recipientSelection : step === 2 ? true : false;

  const loadQuote = () => {
    if (!letterId || !recipientSelection) return;
    startTransition(async () => {
      const result = await quoteSendJobAction(null, {
        letterId,
        recipients: recipientSelection,
        options: { isColor, isDuplex, registered },
      });
      setQuote(result);
      if (!result.ok) toast.error(result.error);
    });
  };

  const goNext = () => {
    if (step === 2) loadQuote();
    setStep((s) => Math.min(s + 1, 3));
  };

  const confirm = (isTest: boolean) => {
    if (!letterId || !recipientSelection) return;
    const scheduledReleaseAt =
      delayHours > 0 && !isTest
        ? new Date(Date.now() + delayHours * 3_600_000).toISOString()
        : null;
    startTransition(async () => {
      const result = await confirmSendJobAction(null, {
        letterId,
        recipients: recipientSelection,
        options: { isColor, isDuplex, registered },
        clientToken: isTest ? clientTokens.test : clientTokens.real,
        isTest,
        scheduledReleaseAt,
      });
      if (result.ok) {
        toast.success(de.send.jobCreated);
        router.push(`/app/sendungen/${result.jobId}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{de.send.title}</h1>
        <p className="text-muted-foreground text-sm">{de.send.subtitle}</p>
      </div>

      <ol className="flex flex-wrap gap-2" aria-label={de.send.title}>
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex size-6 items-center justify-center rounded-full text-xs font-medium ${
                i < step
                  ? "bg-emerald-600 text-white"
                  : i === step
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
              aria-current={i === step ? "step" : undefined}
            >
              {i < step ? <CheckCircle2 className="size-4" /> : i + 1}
            </span>
            <span className={i === step ? "text-sm font-medium" : "text-muted-foreground text-sm"}>
              {label}
            </span>
            {i < STEPS.length - 1 ? <span className="text-muted-foreground">→</span> : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{de.send.chooseLetter}</CardTitle>
          </CardHeader>
          <CardContent>
            {letters.length === 0 ? (
              <div className="text-muted-foreground space-y-3 py-6 text-center text-sm">
                <p>{de.send.noLetters}</p>
                <ButtonLink href="/app/briefe/neu">{de.letters.newLetter}</ButtonLink>
              </div>
            ) : (
              <RadioGroup
                value={letterId ?? ""}
                onValueChange={(v) => setLetterId(v)}
                className="space-y-2"
              >
                {letters.map((letter) => (
                  <Label
                    key={letter.id}
                    className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-md border p-3 font-normal"
                  >
                    <RadioGroupItem value={letter.id} />
                    <FileText className="text-muted-foreground size-4" aria-hidden />
                    <span className="flex-1">
                      {letter.title}
                      <span className="text-muted-foreground block text-xs">
                        {letter.source === "editor" ? de.letters.sourceEditor : de.letters.sourceUpload}
                        {letter.sheet_count ? ` · ${letter.sheet_count} ${de.letters.sheetCount}` : ""}
                      </span>
                    </span>
                    {letter.has_placeholders ? (
                      <Badge variant="secondary">{de.letters.serialLetterBadge}</Badge>
                    ) : null}
                  </Label>
                ))}
              </RadioGroup>
            )}
          </CardContent>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{de.send.chooseRecipients}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <RadioGroup
              value={recipientSource}
              onValueChange={(v) => setRecipientSource(v as "lead_list" | "contacts")}
              className="flex gap-4"
            >
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="lead_list" />
                {de.send.fromLeadList}
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="contacts" />
                {de.send.fromContacts}
              </Label>
            </RadioGroup>

            {recipientSource === "lead_list" ? (
              leadLists.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-sm">{de.send.noLists}</p>
                  <ButtonLink href="/app/kontakte/import" variant="outline" size="sm">
                    {de.send.noListsCta}
                  </ButtonLink>
                </div>
              ) : (
                <Select value={leadListId ?? undefined} onValueChange={setLeadListId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={de.send.fromLeadList}>
                      {(() => {
                        const list = leadLists.find((l) => l.id === leadListId);
                        return list ? `${list.name} (${de.leadLists.entries(list.count)})` : undefined;
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {leadLists.map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.name} ({de.leadLists.entries(list.count)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            ) : (
              <ContactPicker selected={selectedContacts} onChange={setSelectedContacts} />
            )}
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{de.send.stepOptions}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="opt-color">{de.send.colorLabel}</Label>
                <p className="text-muted-foreground text-xs">{de.send.colorHint}</p>
              </div>
              <Switch id="opt-color" checked={isColor} onCheckedChange={setIsColor} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="opt-duplex">{de.send.duplexLabel}</Label>
                <p className="text-muted-foreground text-xs">{de.send.duplexHint}</p>
              </div>
              <Switch id="opt-duplex" checked={isDuplex} onCheckedChange={setIsDuplex} />
            </div>
            {availableRegistered.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="opt-registered">{de.send.registeredLabel}</Label>
                <Select value={registered} onValueChange={(v) => setRegistered(v as Registered)}>
                  <SelectTrigger id="opt-registered" className="w-full">
                    <SelectValue>
                      {
                        {
                          none: de.send.registeredNone,
                          einwurf: de.send.registeredEinwurf,
                          einschreiben: de.send.registeredEinschreiben,
                          rueckschein: de.send.registeredRueckschein,
                        }[registered]
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{de.send.registeredNone}</SelectItem>
                    {availableRegistered.includes("einwurf") ? (
                      <SelectItem value="einwurf">{de.send.registeredEinwurf}</SelectItem>
                    ) : null}
                    {availableRegistered.includes("einschreiben") ? (
                      <SelectItem value="einschreiben">{de.send.registeredEinschreiben}</SelectItem>
                    ) : null}
                    {availableRegistered.includes("rueckschein") ? (
                      <SelectItem value="rueckschein">{de.send.registeredRueckschein}</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="opt-schedule">{de.send.scheduleLabel}</Label>
              <p className="text-muted-foreground text-xs">{de.send.scheduleHint}</p>
              <Select value={String(delayHours)} onValueChange={(v) => setDelayHours(Number(v))}>
                <SelectTrigger id="opt-schedule" className="w-full">
                  <SelectValue>
                    {delayHours === 0 ? de.send.scheduleNone : de.send.scheduleHours(delayHours)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{de.send.scheduleNone}</SelectItem>
                  <SelectItem value="4">{de.send.scheduleHours(4)}</SelectItem>
                  <SelectItem value="24">{de.send.scheduleHours(24)}</SelectItem>
                  <SelectItem value="48">{de.send.scheduleHours(48)}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <ConfirmStep
          quote={quote}
          pending={pending}
          hasSender={senderAddresses.length > 0}
          hasPlaceholders={selectedLetter?.has_placeholders ?? false}
          mockMode={mockMode}
          onConfirm={() => confirm(false)}
          onTest={() => confirm(true)}
        />
      ) : null}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || pending}>
          {de.common.back}
        </Button>
        {step < 3 ? (
          <Button onClick={goNext} disabled={!canNext || pending}>
            {de.common.next}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ContactPicker({
  selected,
  onChange,
}: {
  selected: ContactHit[];
  onChange: (contacts: ContactHit[]) => void;
}) {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [, startSearch] = useTransition();

  useEffect(() => {
    if (term.trim().length < 2) return;
    const handle = setTimeout(() => {
      startSearch(async () => {
        const result = await searchContactsAction(term.trim());
        setHits(result.filter((h) => !selected.some((s) => s.id === h.id)));
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [term, selected]);

  const label = (c: ContactHit) =>
    [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || c.city;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Input
          type="search"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            if (e.target.value.trim().length < 2) setHits([]);
          }}
          placeholder={de.send.searchContacts}
          aria-label={de.send.searchContacts}
        />
        {hits.length > 0 ? (
          <ul className="bg-popover absolute z-10 mt-1 w-full rounded-md border shadow-md">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange([...selected, hit]);
                    setHits((prev) => prev.filter((h) => h.id !== hit.id));
                  }}
                  className="hover:bg-muted flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                >
                  <Users className="text-muted-foreground size-3.5" aria-hidden />
                  {label(hit)}
                  <span className="text-muted-foreground">· {hit.city}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {selected.length > 0 ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">{de.send.selectedCount(selected.length)}</p>
          <ul className="flex flex-wrap gap-1.5">
            {selected.map((c) => (
              <li key={c.id}>
                <Badge variant="secondary" className="gap-1">
                  {label(c)}
                  <button
                    type="button"
                    aria-label={`${label(c)} entfernen`}
                    onClick={() => onChange(selected.filter((s) => s.id !== c.id))}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{de.send.noContactsSelected}</p>
      )}
    </div>
  );
}

function ConfirmStep({
  quote,
  pending,
  hasSender,
  hasPlaceholders,
  mockMode,
  onConfirm,
  onTest,
}: {
  quote: QuoteResult | null;
  pending: boolean;
  hasSender: boolean;
  hasPlaceholders: boolean;
  mockMode: boolean;
  onConfirm: () => void;
  onTest: () => void;
}) {
  if (!quote) {
    return <p className="text-muted-foreground py-6 text-center text-sm">{de.common.loading}</p>;
  }
  if (!quote.ok) {
    return (
      <p className="bg-destructive/10 text-destructive rounded-md p-4 text-sm">{quote.error}</p>
    );
  }

  const after = quote.balanceCents - quote.totalCents;

  return (
    <div className="space-y-4">
      {!hasSender ? (
        <div className="bg-destructive/10 text-destructive space-y-2 rounded-md p-3 text-sm">
          <p>{de.send.noSenderAddress}</p>
          <ButtonLink href="/app/einstellungen/absenderadressen" variant="outline"
            size="sm">
            {de.send.createSenderAddress}
          </ButtonLink>
        </div>
      ) : null}
      {mockMode ? (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {de.send.mockNotice}
        </p>
      ) : null}
      {hasPlaceholders ? (
        <p className="rounded-md bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-200">
          {de.send.serienbriefNote(quote.recipientCount)}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.send.costPreview}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{de.send.recipients}</dt>
              <dd className="font-medium">{quote.recipientCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{de.send.sheets}</dt>
              <dd className="font-medium">{quote.sheets}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {de.send.perLetter}
                {quote.discountPercent > 0 ? (
                  <span className="block text-xs">
                    {de.send.discount(String(quote.discountPercent))}
                  </span>
                ) : null}
              </dt>
              <dd className="font-medium">{formatCents(quote.pricePerLetterCents)}</dd>
            </div>
            <div className="flex justify-between border-t pt-2 text-base">
              <dt className="font-medium">{de.send.total}</dt>
              <dd className="font-semibold">{formatCents(quote.totalCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{de.send.balance}</dt>
              <dd>{formatCents(quote.balanceCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{de.send.balanceAfter}</dt>
              <dd className={after < 0 ? "text-destructive font-medium" : ""}>
                {formatCents(after)}
              </dd>
            </div>
          </dl>
          <p className="text-muted-foreground mt-3 text-xs">{de.send.netHint}</p>
        </CardContent>
      </Card>

      {!quote.sufficient ? (
        <div className="bg-destructive/10 text-destructive space-y-2 rounded-md p-3 text-sm">
          <p>
            {de.send.insufficientFunds}{" "}
            {de.send.missingAmount(formatCents(quote.totalCents - quote.balanceCents))}
          </p>
          <ButtonLink href="/app/guthaben" size="sm">
            {de.send.topUpCta}
          </ButtonLink>
        </div>
      ) : null}

      <div className="rounded-md border p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <FlaskConical className="size-4" aria-hidden />
          {de.send.testSend}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">{de.send.testSendHint}</p>
        <Button variant="outline" className="mt-3" onClick={onTest} disabled={pending || !hasSender}>
          {pending ? de.send.confirming : de.send.confirmTestButton}
        </Button>
      </div>

      <Button
        className="w-full"
        size="lg"
        onClick={onConfirm}
        disabled={pending || !quote.sufficient || !hasSender}
      >
        {pending ? de.send.confirming : de.send.confirmButton}
      </Button>
    </div>
  );
}
