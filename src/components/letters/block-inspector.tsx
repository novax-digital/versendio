"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Copy,
  ImagePlus,
  Info,
  Trash2,
} from "lucide-react";
import { uploadAssetAction } from "@/app/(app)/app/briefe/actions";
import type { LetterBlock, LetterDocument, LetterTheme } from "@/lib/shared/letter-document";
import { ACCENT_SWATCHES } from "@/lib/shared/letter-document";
import { LETTER_FONTS, LETTER_FONT_IDS } from "@/lib/shared/letter-fonts";
import { BLOCK_TYPE_META } from "@/components/letters/block-insert-menu";
import { InspectorSection } from "@/components/letters/inspector-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { de } from "@/lib/i18n/de";

type SenderAddress = { id: string; label: string; sender_line: string; is_default: boolean };
export type LetterheadOption = { id: string; name: string };

type DocPatch = Partial<
  Pick<
    LetterDocument,
    | "logoStoragePath"
    | "header"
    | "footer"
    | "showDate"
    | "dateStyle"
    | "dateWithPlace"
    | "senderAddressId"
  >
>;

/** Hint text demoted to an info icon with tooltip — keeps the panel calm. */
function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" aria-label={text} className="text-muted-foreground align-middle" />
        }
      >
        <Info className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  );
}

/** One consistent exclusive-choice control: muted track, filled active item. */
function SegmentedGroup<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; ariaLabel?: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="bg-muted inline-flex gap-0.5 rounded-lg p-0.5" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <Button
          key={String(o.value)}
          type="button"
          size="sm"
          variant="ghost"
          aria-label={o.ariaLabel}
          aria-pressed={value === o.value}
          className={cn(
            "h-6.5 px-2",
            value === o.value && "bg-background text-foreground shadow-sm hover:bg-background",
          )}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Right-hand inspector: a contextual "Baustein" card on top (block styles or
 * the block palette when nothing is selected), followed by document sections
 * ordered by editing frequency (Versand, Briefpapier, Gestaltung, Kopf & Fuß).
 */
export function BlockInspector({
  doc,
  selected,
  senderAddresses,
  letterheads,
  onChangeBlock,
  onChangeTheme,
  onChangeDoc,
  onApplyLetterhead,
  onSaveLetterhead,
  onFocusChromeText,
  onAddBlock,
  onAddImage,
  onDuplicateBlock,
  onRemoveBlock,
  forceOpenHeaderFooter,
}: {
  doc: LetterDocument;
  selected: LetterBlock | null;
  senderAddresses: SenderAddress[];
  letterheads: LetterheadOption[];
  onChangeBlock: (id: string, patch: Partial<LetterBlock>) => void;
  onChangeTheme: (patch: Partial<LetterTheme>) => void;
  onChangeDoc: (patch: DocPatch) => void;
  onApplyLetterhead: (id: string) => void;
  onSaveLetterhead: (name: string) => void;
  onFocusChromeText: (kind: "header" | "footer", el: HTMLTextAreaElement) => void;
  onAddBlock: (type: Exclude<LetterBlock["type"], "image">) => void;
  onAddImage: (file: File) => void;
  onDuplicateBlock: (id: string) => void;
  onRemoveBlock: (id: string) => void;
  /** Bumped counter: force-opens the "Kopf & Fuß" section (sheet chrome-zone click). */
  forceOpenHeaderFooter?: number;
}) {
  const paletteFileRef = useRef<HTMLInputElement>(null);
  const selectedMeta = selected ? BLOCK_TYPE_META[selected.type] : null;

  return (
    <div className="space-y-3">
      {/* Contextual block card */}
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          {selected && selectedMeta ? (
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <selectedMeta.icon className="text-muted-foreground size-4" aria-hidden />
                {selectedMeta.label}
              </CardTitle>
              <div className="flex gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={de.letters.duplicateBlock}
                  title={de.letters.duplicateBlock}
                  onClick={() => onDuplicateBlock(selected.id)}
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive"
                  aria-label={de.letters.removeBlock}
                  title={de.letters.removeBlock}
                  onClick={() => onRemoveBlock(selected.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <CardTitle className="text-sm">{de.letters.addBlock}</CardTitle>
          )}
        </CardHeader>
        <CardContent className="px-4">
          {selected ? (
            <BlockControls
              block={selected}
              theme={doc.theme}
              onChange={(patch) => onChangeBlock(selected.id, patch)}
            />
          ) : (
            <>
              <input
                ref={paletteFileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onAddImage(file);
                  e.target.value = "";
                }}
              />
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(BLOCK_TYPE_META) as LetterBlock["type"][]).map((type) => {
                  const meta = BLOCK_TYPE_META[type];
                  const Icon = meta.icon;
                  return (
                    <Button
                      key={type}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="justify-start"
                      onClick={() =>
                        type === "image" ? paletteFileRef.current?.click() : onAddBlock(type)
                      }
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {meta.label}
                    </Button>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Document sections, ordered by editing frequency */}
      <InspectorSection id="versand" title={de.letters.sectionShipping} defaultOpen>
        <div className="space-y-1.5">
          <Label>{de.letters.senderAddressSelect}</Label>
          {senderAddresses.length === 0 ? (
            <Link
              href="/app/einstellungen/absenderadressen"
              className="text-primary block text-sm underline-offset-4 hover:underline"
            >
              {de.letters.createSenderAddress}
            </Link>
          ) : (
            <Select
              value={doc.senderAddressId ?? undefined}
              onValueChange={(v) => onChangeDoc({ senderAddressId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder={de.letters.senderAddressSelect}>
                  {senderAddresses.find((a) => a.id === doc.senderAddressId)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {senderAddresses.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="show-date"
            checked={doc.showDate}
            onCheckedChange={(checked) => onChangeDoc({ showDate: checked })}
          />
          <Label htmlFor="show-date" className="font-normal">
            {de.letters.themeShowDate}
          </Label>
          <InfoTip text={de.letters.themeShowDateHint} />
        </div>
        {doc.showDate ? (
          <>
            <div className="space-y-1.5">
              <Label>{de.letters.dateStyleLabel}</Label>
              <SegmentedGroup
                value={doc.dateStyle}
                options={[
                  { value: "short" as const, label: de.letters.dateStyleShort },
                  { value: "long" as const, label: de.letters.dateStyleLong },
                ]}
                onChange={(dateStyle) => onChangeDoc({ dateStyle })}
                ariaLabel={de.letters.dateStyleLabel}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="date-place"
                checked={doc.dateWithPlace}
                onCheckedChange={(checked) => onChangeDoc({ dateWithPlace: checked })}
              />
              <Label htmlFor="date-place" className="font-normal">
                {de.letters.dateWithPlace}
              </Label>
              <InfoTip text={de.letters.dateWithPlaceHint} />
            </div>
          </>
        ) : null}
      </InspectorSection>

      <InspectorSection id="briefpapier" title={de.letters.letterheadSection} defaultOpen>
        <p className="text-muted-foreground text-xs">{de.letters.letterheadHint}</p>
        {letterheads.length > 0 ? (
          <LetterheadApply letterheads={letterheads} onApply={onApplyLetterhead} />
        ) : (
          <p className="text-muted-foreground text-xs">{de.letters.noLetterheads}</p>
        )}
        <LetterheadSave onSave={onSaveLetterhead} />
      </InspectorSection>

      <InspectorSection id="gestaltung" title={de.letters.sectionDesign}>
        <div className="space-y-1.5">
          <Label>{de.letters.themeFont}</Label>
          <Select
            value={doc.theme.fontFamily}
            onValueChange={(v) => onChangeTheme({ fontFamily: v as LetterTheme["fontFamily"] })}
          >
            <SelectTrigger>
              <SelectValue>
                <span style={{ fontFamily: LETTER_FONTS[doc.theme.fontFamily].cssStack }}>
                  {LETTER_FONTS[doc.theme.fontFamily].label}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {LETTER_FONT_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  <span style={{ fontFamily: LETTER_FONTS[id].cssStack }}>
                    {LETTER_FONTS[id].label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{de.letters.themeBaseSize}</Label>
          <SegmentedGroup
            value={doc.theme.baseSizePt}
            options={[10, 11, 12].map((size) => ({ value: size, label: `${size} pt` }))}
            onChange={(size) => onChangeTheme({ baseSizePt: size })}
            ariaLabel={de.letters.themeBaseSize}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label>{de.letters.themeAccent}</Label>
            <InfoTip text={de.letters.colorPrintHint} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ACCENT_SWATCHES.map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={hex}
                className={cn(
                  "size-6 rounded-full border transition-transform",
                  doc.theme.accentColor === hex
                    ? "ring-ring scale-110 ring-2 ring-offset-1"
                    : "hover:scale-105",
                )}
                style={{ backgroundColor: hex }}
                onClick={() => onChangeTheme({ accentColor: hex })}
              />
            ))}
          </div>
        </div>
      </InspectorSection>

      <InspectorSection
        id="kopf-fuss"
        title={de.letters.sectionHeaderFooter}
        forceOpen={forceOpenHeaderFooter}
      >
        <LogoCluster doc={doc} onChangeDoc={onChangeDoc} />

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="header-text">{de.letters.headerTextLabel}</Label>
            <InfoTip text={de.letters.headerTextHint} />
          </div>
          <Textarea
            id="header-text"
            value={doc.header.text}
            rows={3}
            maxLength={400}
            placeholder={de.letters.headerTextPlaceholder}
            onChange={(e) => onChangeDoc({ header: { ...doc.header, text: e.target.value } })}
            onFocus={(e) => onFocusChromeText("header", e.currentTarget)}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="footer-text">{de.letters.footerTextLabel}</Label>
            <InfoTip text={de.letters.footerTextHint} />
          </div>
          <Textarea
            id="footer-text"
            value={doc.footer.text}
            rows={3}
            maxLength={600}
            placeholder={de.letters.footerTextPlaceholder}
            onChange={(e) => onChangeDoc({ footer: { text: e.target.value } })}
            onFocus={(e) => onFocusChromeText("footer", e.currentTarget)}
          />
        </div>
      </InspectorSection>
    </div>
  );
}

function LetterheadApply({
  letterheads,
  onApply,
}: {
  letterheads: LetterheadOption[];
  onApply: (id: string) => void;
}) {
  const [letterheadId, setLetterheadId] = useState<string | null>(null);
  return (
    <div className="flex gap-2">
      <Select value={letterheadId ?? undefined} onValueChange={setLetterheadId}>
        <SelectTrigger className="min-w-0 flex-1">
          <SelectValue placeholder={de.letters.letterheadSelect}>
            {letterheads.find((l) => l.id === letterheadId)?.name}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {letterheads.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!letterheadId}
        onClick={() => letterheadId && onApply(letterheadId)}
      >
        {de.letters.applyLetterhead}
      </Button>
    </div>
  );
}

/** Save-as-letterhead behind a popover: one calm button instead of a form row. */
function LetterheadSave({ onSave }: { onSave: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}>
        {de.letters.saveAsLetterhead}
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2" align="start">
        <Input
          value={name}
          placeholder={de.letters.letterheadNamePlaceholder}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={!name.trim()}
          onClick={() => {
            onSave(name.trim());
            setName("");
            setOpen(false);
          }}
        >
          {de.letters.saveAsLetterhead}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Logo upload/remove/position as ONE unit; position slot is stable (no layout jump). */
function LogoCluster({
  doc,
  onChangeDoc,
}: {
  doc: LetterDocument;
  onChangeDoc: (patch: DocPatch) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isUploading, startUpload] = useTransition();

  const uploadLogo = (file: File) => {
    startUpload(async () => {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadAssetAction(null, formData);
      if (result.ok && result.data) {
        onChangeDoc({ logoStoragePath: result.data.path });
      } else {
        toast.error(result.ok ? de.common.genericError : result.error);
      }
    });
  };

  return (
    <div className="space-y-2">
      <Label>{de.letters.logo}</Label>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadLogo(file);
          e.target.value = "";
        }}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isUploading}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus className="size-4" aria-hidden />
          {isUploading ? de.common.saving : de.letters.uploadImage}
        </Button>
        {doc.logoStoragePath ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => onChangeDoc({ logoStoragePath: null })}
          >
            <Trash2 className="size-4" aria-hidden />
            {de.letters.removeLogo}
          </Button>
        ) : null}
      </div>
      <div
        className={cn(
          "flex items-center gap-2",
          !doc.logoStoragePath && "pointer-events-none opacity-50",
        )}
      >
        <span className="text-muted-foreground text-xs">{de.letters.logoPositionLabel}</span>
        <SegmentedGroup
          value={doc.header.logoAlign}
          options={[
            { value: "left" as const, label: de.letters.alignLeft },
            { value: "right" as const, label: de.letters.alignRight },
          ]}
          onChange={(side) => onChangeDoc({ header: { ...doc.header, logoAlign: side } })}
          ariaLabel={de.letters.logoPositionLabel}
        />
      </div>
    </div>
  );
}

function BlockControls({
  block,
  theme,
  onChange,
}: {
  block: LetterBlock;
  theme: LetterTheme;
  onChange: (patch: Partial<LetterBlock>) => void;
}) {
  void theme;
  if (block.type === "subject" || block.type === "heading" || block.type === "text") {
    return (
      <div className="space-y-4">
        {block.type === "heading" ? (
          <div className="space-y-1.5">
            <Label>{de.letters.headingLevelLabel}</Label>
            <SegmentedGroup
              value={block.level}
              options={[
                { value: 1 as const, label: de.letters.headingLevel1 },
                { value: 2 as const, label: de.letters.headingLevel2 },
              ]}
              onChange={(level) => onChange({ level })}
              ariaLabel={de.letters.headingLevelLabel}
            />
          </div>
        ) : null}
        {block.type === "text" ? (
          <div className="space-y-1.5">
            <Label>{de.letters.sizeDeltaLabel}</Label>
            <SegmentedGroup
              value={block.sizeDeltaPt}
              options={([-1, 0, 1, 2] as const).map((delta) => ({
                value: delta,
                label: delta > 0 ? `+${delta}` : String(delta),
              }))}
              onChange={(sizeDeltaPt) => onChange({ sizeDeltaPt })}
              ariaLabel={de.letters.sizeDeltaLabel}
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label>{de.letters.alignLabel}</Label>
          <SegmentedGroup
            value={block.align}
            options={[
              { value: "left" as const, label: <AlignLeft className="size-3.5" aria-hidden />, ariaLabel: de.letters.alignLeft },
              { value: "center" as const, label: <AlignCenter className="size-3.5" aria-hidden />, ariaLabel: de.letters.alignCenter },
              { value: "right" as const, label: <AlignRight className="size-3.5" aria-hidden />, ariaLabel: de.letters.alignRight },
            ]}
            onChange={(align) => onChange({ align })}
            ariaLabel={de.letters.alignLabel}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label>{de.letters.colorLabel}</Label>
            <InfoTip text={de.letters.colorPrintHint} />
          </div>
          <SegmentedGroup
            value={block.color}
            options={[
              { value: "default" as const, label: de.letters.colorDefault },
              { value: "accent" as const, label: de.letters.colorAccent },
              ...(block.type === "text"
                ? [{ value: "muted" as const, label: de.letters.colorMuted }]
                : []),
            ]}
            onChange={(color) => onChange({ color })}
            ariaLabel={de.letters.colorLabel}
          />
        </div>
      </div>
    );
  }

  if (block.type === "divider") {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="divider-width">{de.letters.dividerWidth}</Label>
          <Input
            id="divider-width"
            type="number"
            min={20}
            max={100}
            key={`${block.id}-w`}
            defaultValue={block.widthPct}
            onBlur={(e) => {
              const n = Number(e.target.value);
              const clamped = Number.isFinite(n) ? Math.min(100, Math.max(20, n)) : 100;
              e.target.value = String(clamped);
              onChange({ widthPct: clamped });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{de.letters.dividerStrength}</Label>
          <SegmentedGroup
            value={block.thicknessPt}
            options={([0.5, 0.75, 1, 1.5, 2] as const).map((t) => ({ value: t, label: String(t) }))}
            onChange={(thicknessPt) => onChange({ thicknessPt })}
            ariaLabel={de.letters.dividerStrength}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{de.letters.colorLabel}</Label>
          <SegmentedGroup
            value={block.color}
            options={[
              { value: "muted" as const, label: de.letters.colorMuted },
              { value: "accent" as const, label: de.letters.colorAccent },
            ]}
            onChange={(color) => onChange({ color })}
            ariaLabel={de.letters.colorLabel}
          />
        </div>
      </div>
    );
  }

  if (block.type === "spacer") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor="spacer-height">{de.letters.spacerHeightLabel}</Label>
        <Input
          id="spacer-height"
          type="number"
          min={1}
          max={120}
          key={`${block.id}-h`}
          defaultValue={block.heightMm}
          onBlur={(e) => {
            const n = Number(e.target.value);
            const clamped = Number.isFinite(n) ? Math.min(120, Math.max(1, n)) : 8;
            e.target.value = String(clamped);
            onChange({ heightMm: clamped });
          }}
        />
      </div>
    );
  }

  if (block.type === "image") {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="image-width">{de.letters.imageWidthLabel}</Label>
          <Input
            id="image-width"
            type="number"
            min={5}
            max={180}
            key={`${block.id}-iw`}
            defaultValue={block.widthMm}
            onBlur={(e) => {
              const n = Number(e.target.value);
              const clamped = Number.isFinite(n) ? Math.min(180, Math.max(5, n)) : 80;
              e.target.value = String(clamped);
              onChange({ widthMm: clamped });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{de.letters.alignLabel}</Label>
          <SegmentedGroup
            value={block.align}
            options={[
              { value: "left" as const, label: <AlignLeft className="size-3.5" aria-hidden />, ariaLabel: de.letters.alignLeft },
              { value: "center" as const, label: <AlignCenter className="size-3.5" aria-hidden />, ariaLabel: de.letters.alignCenter },
              { value: "right" as const, label: <AlignRight className="size-3.5" aria-hidden />, ariaLabel: de.letters.alignRight },
            ]}
            onChange={(align) => onChange({ align })}
            ariaLabel={de.letters.alignLabel}
          />
        </div>
      </div>
    );
  }

  return null;
}
