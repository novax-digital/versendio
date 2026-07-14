"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { generateLetterDraftAction } from "@/app/(app)/app/briefe/ai-actions";
import type { DraftBlock } from "@/lib/server/ai/draft-provider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { de } from "@/lib/i18n/de";

/**
 * KI-Entwurf dialog: collects Anlass/Stichpunkte/Ton/Länge, calls the
 * server action (quota- and credit-gated) and hands the validated draft
 * (subject + paragraphs) to the builder for insertion.
 */
export function AiDraftDialog({
  mock,
  onDraft,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  /** True when no AI key is configured — the MockDraftProvider will answer. */
  mock: boolean;
  onDraft: (draft: { betreff: string; bloecke: DraftBlock[] }) => void;
  /** Controlled mode: open state lifted so other UI can launch the dialog. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [anlass, setAnlass] = useState("");
  const [stichpunkte, setStichpunkte] = useState("");
  const [tonalitaet, setTonalitaet] = useState<"formell" | "freundlich" | "verbindlich">("formell");
  const [laenge, setLaenge] = useState<"kurz" | "mittel" | "lang">("mittel");
  const [isGenerating, startGenerating] = useTransition();

  const generate = () => {
    startGenerating(async () => {
      const result = await generateLetterDraftAction(null, {
        anlass,
        stichpunkte,
        tonalitaet,
        laenge,
      });
      if (result.ok && result.data) {
        onDraft(result.data);
        toast.success(de.letters.aiInserted);
        setOpen(false);
      } else {
        toast.error(result.ok ? de.letters.aiFailed : result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger ? (
        <DialogTrigger render={<Button variant="outline" />}>
          <Sparkles className="size-4" aria-hidden />
          {de.letters.aiButton}
        </DialogTrigger>
      ) : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{de.letters.aiDialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ai-anlass">{de.letters.aiAnlassLabel}</Label>
            <Textarea
              id="ai-anlass"
              rows={2}
              maxLength={600}
              value={anlass}
              onChange={(e) => setAnlass(e.target.value)}
              placeholder={de.letters.aiAnlassPlaceholder}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-stichpunkte">{de.letters.aiStichpunkteLabel}</Label>
            <Textarea
              id="ai-stichpunkte"
              rows={5}
              maxLength={1200}
              value={stichpunkte}
              onChange={(e) => setStichpunkte(e.target.value)}
              placeholder={de.letters.aiStichpunktePlaceholder}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{de.letters.aiTonLabel}</Label>
              <Select value={tonalitaet} onValueChange={(v) => setTonalitaet(v as typeof tonalitaet)}>
                <SelectTrigger>
                  <SelectValue>
                    {
                      {
                        formell: de.letters.aiTonFormell,
                        freundlich: de.letters.aiTonFreundlich,
                        verbindlich: de.letters.aiTonVerbindlich,
                      }[tonalitaet]
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="formell">{de.letters.aiTonFormell}</SelectItem>
                  <SelectItem value="freundlich">{de.letters.aiTonFreundlich}</SelectItem>
                  <SelectItem value="verbindlich">{de.letters.aiTonVerbindlich}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{de.letters.aiLaengeLabel}</Label>
              <Select value={laenge} onValueChange={(v) => setLaenge(v as typeof laenge)}>
                <SelectTrigger>
                  <SelectValue>
                    {
                      {
                        kurz: de.letters.aiLaengeKurz,
                        mittel: de.letters.aiLaengeMittel,
                        lang: de.letters.aiLaengeLang,
                      }[laenge]
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kurz">{de.letters.aiLaengeKurz}</SelectItem>
                  <SelectItem value="mittel">{de.letters.aiLaengeMittel}</SelectItem>
                  <SelectItem value="lang">{de.letters.aiLaengeLang}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            {de.letters.aiPrivacyNotice} {de.letters.aiDailyInfo}
          </p>
          <div className="flex items-center justify-between gap-2">
            {mock ? (
              <Badge variant="outline" className="border-warning text-warning">
                {de.letters.aiMockBadge}
              </Badge>
            ) : (
              <span />
            )}
            <Button
              onClick={generate}
              disabled={isGenerating || anlass.trim().length < 3 || stichpunkte.trim().length < 3}
            >
              {isGenerating ? de.letters.aiGenerating : de.letters.aiGenerate}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
