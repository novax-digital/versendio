"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ImagePlus, Trash2 } from "lucide-react";
import { uploadAssetAction } from "@/app/(app)/app/briefe/actions";
import type { LetterBlock, LetterDocument, LetterTheme } from "@/lib/shared/letter-document";
import { ACCENT_SWATCHES } from "@/lib/shared/letter-document";
import { LETTER_FONTS, LETTER_FONT_IDS } from "@/lib/shared/letter-fonts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Pick<LetterDocument, "logoStoragePath" | "header" | "footer" | "showDate" | "senderAddressId">
>;

/**
 * Right-hand inspector of the letter builder: "Baustein" styles the selected
 * block, "Brief" holds the document theme (font, base size, accent color,
 * logo, header/footer, letterhead, date, sender address).
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
}) {
  const [tab, setTab] = useState<string>(selected ? "block" : "letter");
  // Auto-switch to the block tab when the selection changes (React's
  // "adjust state during render" pattern — guarded, no effect needed).
  const selectedIdKey = selected?.id ?? null;
  const [prevSelectedId, setPrevSelectedId] = useState<string | null>(selectedIdKey);
  if (selectedIdKey !== prevSelectedId) {
    setPrevSelectedId(selectedIdKey);
    if (selectedIdKey) setTab("block");
  }

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="w-full">
        <TabsTrigger value="block" className="flex-1">
          {de.letters.inspectorBlockTab}
        </TabsTrigger>
        <TabsTrigger value="letter" className="flex-1">
          {de.letters.inspectorLetterTab}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="block" className="space-y-4 pt-3">
        {selected ? (
          <BlockControls block={selected} onChange={(patch) => onChangeBlock(selected.id, patch)} />
        ) : (
          <p className="text-muted-foreground text-sm">{de.letters.inspectorNoSelection}</p>
        )}
      </TabsContent>

      <TabsContent value="letter" className="space-y-4 pt-3">
        <LetterControls
          doc={doc}
          senderAddresses={senderAddresses}
          letterheads={letterheads}
          onChangeTheme={onChangeTheme}
          onChangeDoc={onChangeDoc}
          onApplyLetterhead={onApplyLetterhead}
          onSaveLetterhead={onSaveLetterhead}
        />
      </TabsContent>
    </Tabs>
  );
}

function AlignPicker({
  value,
  onChange,
}: {
  value: "left" | "center" | "right";
  onChange: (v: "left" | "center" | "right") => void;
}) {
  const options = [
    { v: "left" as const, label: de.letters.alignLeft },
    { v: "center" as const, label: de.letters.alignCenter },
    { v: "right" as const, label: de.letters.alignRight },
  ];
  return (
    <div className="space-y-1.5">
      <Label>{de.letters.alignLabel}</Label>
      <div className="flex gap-1">
        {options.map((o) => (
          <Button
            key={o.v}
            type="button"
            size="sm"
            variant={value === o.v ? "secondary" : "ghost"}
            onClick={() => onChange(o.v)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
  withMuted,
}: {
  value: "default" | "accent" | "muted";
  onChange: (v: "default" | "accent" | "muted") => void;
  withMuted: boolean;
}) {
  const options = [
    { v: "default" as const, label: de.letters.colorDefault },
    { v: "accent" as const, label: de.letters.colorAccent },
    ...(withMuted ? [{ v: "muted" as const, label: de.letters.colorMuted }] : []),
  ];
  return (
    <div className="space-y-1.5">
      <Label>{de.letters.colorLabel}</Label>
      <div className="flex gap-1">
        {options.map((o) => (
          <Button
            key={o.v}
            type="button"
            size="sm"
            variant={value === o.v ? "secondary" : "ghost"}
            onClick={() => onChange(o.v)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function BlockControls({
  block,
  onChange,
}: {
  block: LetterBlock;
  onChange: (patch: Partial<LetterBlock>) => void;
}) {
  if (block.type === "subject" || block.type === "heading" || block.type === "text") {
    return (
      <div className="space-y-4">
        {block.type === "heading" ? (
          <div className="space-y-1.5">
            <Label>{de.letters.headingLevelLabel}</Label>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={block.level === 1 ? "secondary" : "ghost"}
                onClick={() => onChange({ level: 1 })}
              >
                {de.letters.headingLevel1}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={block.level === 2 ? "secondary" : "ghost"}
                onClick={() => onChange({ level: 2 })}
              >
                {de.letters.headingLevel2}
              </Button>
            </div>
          </div>
        ) : null}
        {block.type === "text" ? (
          <div className="space-y-1.5">
            <Label>{de.letters.sizeDeltaLabel}</Label>
            <div className="flex gap-1">
              {([-1, 0, 1, 2] as const).map((delta) => (
                <Button
                  key={delta}
                  type="button"
                  size="sm"
                  variant={block.sizeDeltaPt === delta ? "secondary" : "ghost"}
                  onClick={() => onChange({ sizeDeltaPt: delta })}
                >
                  {delta > 0 ? `+${delta}` : delta}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <AlignPicker value={block.align} onChange={(align) => onChange({ align })} />
        <ColorPicker
          value={block.color}
          onChange={(color) => onChange({ color })}
          withMuted={block.type === "text"}
        />
        <p className="text-muted-foreground text-xs">{de.letters.colorPrintHint}</p>
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
          <Label htmlFor="divider-strength">{de.letters.dividerStrength}</Label>
          <div className="flex gap-1">
            {([0.5, 0.75, 1, 1.5, 2] as const).map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={block.thicknessPt === t ? "secondary" : "ghost"}
                onClick={() => onChange({ thicknessPt: t })}
              >
                {t}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>{de.letters.colorLabel}</Label>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={block.color === "muted" ? "secondary" : "ghost"}
              onClick={() => onChange({ color: "muted" })}
            >
              {de.letters.colorMuted}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={block.color === "accent" ? "secondary" : "ghost"}
              onClick={() => onChange({ color: "accent" })}
            >
              {de.letters.colorAccent}
            </Button>
          </div>
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
        <AlignPicker value={block.align} onChange={(align) => onChange({ align })} />
      </div>
    );
  }

  return null;
}

function LetterControls({
  doc,
  senderAddresses,
  letterheads,
  onChangeTheme,
  onChangeDoc,
  onApplyLetterhead,
  onSaveLetterhead,
}: {
  doc: LetterDocument;
  senderAddresses: SenderAddress[];
  letterheads: LetterheadOption[];
  onChangeTheme: (patch: Partial<LetterTheme>) => void;
  onChangeDoc: (patch: DocPatch) => void;
  onApplyLetterhead: (id: string) => void;
  onSaveLetterhead: (name: string) => void;
}) {
  const theme = doc.theme;
  const fileRef = useRef<HTMLInputElement>(null);
  const [isUploading, startUpload] = useTransition();
  const [letterheadId, setLetterheadId] = useState<string | null>(null);
  const [letterheadName, setLetterheadName] = useState("");

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
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{de.letters.themeFont}</Label>
        <Select
          value={theme.fontFamily}
          onValueChange={(v) => onChangeTheme({ fontFamily: v as LetterTheme["fontFamily"] })}
        >
          <SelectTrigger>
            <SelectValue>
              <span style={{ fontFamily: LETTER_FONTS[theme.fontFamily].cssStack }}>
                {LETTER_FONTS[theme.fontFamily].label}
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
        <div className="flex gap-1">
          {([10, 11, 12] as const).map((size) => (
            <Button
              key={size}
              type="button"
              size="sm"
              variant={theme.baseSizePt === size ? "secondary" : "ghost"}
              onClick={() => onChangeTheme({ baseSizePt: size })}
            >
              {size} pt
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{de.letters.themeAccent}</Label>
        <div className="flex flex-wrap gap-1.5">
          {ACCENT_SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={hex}
              className={cn(
                "size-6 rounded-full border transition-transform",
                theme.accentColor === hex
                  ? "ring-ring scale-110 ring-2 ring-offset-1"
                  : "hover:scale-105",
              )}
              style={{ backgroundColor: hex }}
              onClick={() => onChangeTheme({ accentColor: hex })}
            />
          ))}
        </div>
        <p className="text-muted-foreground text-xs">{de.letters.colorPrintHint}</p>
      </div>

      <div className="space-y-1.5">
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
      </div>

      <Separator />

      {/* Header (Kopfbereich) */}
      <div className="space-y-1.5">
        <Label htmlFor="header-text">
          {de.letters.headerSection} · {de.letters.headerTextLabel}
        </Label>
        <Textarea
          id="header-text"
          value={doc.header.text}
          rows={3}
          maxLength={400}
          placeholder={de.letters.headerTextPlaceholder}
          onChange={(e) => onChangeDoc({ header: { ...doc.header, text: e.target.value } })}
        />
        <p className="text-muted-foreground text-xs">{de.letters.headerTextHint}</p>
      </div>
      {doc.logoStoragePath ? (
        <div className="space-y-1.5">
          <Label>{de.letters.logoPositionLabel}</Label>
          <div className="flex gap-1">
            {(["left", "right"] as const).map((side) => (
              <Button
                key={side}
                type="button"
                size="sm"
                variant={doc.header.logoAlign === side ? "secondary" : "ghost"}
                onClick={() => onChangeDoc({ header: { ...doc.header, logoAlign: side } })}
              >
                {side === "left" ? de.letters.alignLeft : de.letters.alignRight}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Footer (Fußbereich) */}
      <div className="space-y-1.5">
        <Label htmlFor="footer-text">
          {de.letters.footerSection} · {de.letters.footerTextLabel}
        </Label>
        <Textarea
          id="footer-text"
          value={doc.footer.text}
          rows={3}
          maxLength={600}
          placeholder={de.letters.footerTextPlaceholder}
          onChange={(e) => onChangeDoc({ footer: { text: e.target.value } })}
        />
        <p className="text-muted-foreground text-xs">{de.letters.footerTextHint}</p>
      </div>

      <Separator />

      {/* Letterhead (Briefpapier) */}
      <div className="space-y-1.5">
        <Label>{de.letters.letterheadSection}</Label>
        <p className="text-muted-foreground text-xs">{de.letters.letterheadHint}</p>
        {letterheads.length > 0 ? (
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
              onClick={() => letterheadId && onApplyLetterhead(letterheadId)}
            >
              {de.letters.applyLetterhead}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">{de.letters.noLetterheads}</p>
        )}
        <div className="flex gap-2">
          <Input
            value={letterheadName}
            placeholder={de.letters.letterheadNamePlaceholder}
            onChange={(e) => setLetterheadName(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!letterheadName.trim()}
            onClick={() => {
              onSaveLetterhead(letterheadName.trim());
              setLetterheadName("");
            }}
          >
            {de.common.save}
          </Button>
        </div>
      </div>

      <Separator />

      <div className="flex items-center gap-2">
        <Switch
          id="show-date"
          checked={doc.showDate}
          onCheckedChange={(checked) => onChangeDoc({ showDate: checked })}
        />
        <Label htmlFor="show-date" className="font-normal">
          {de.letters.themeShowDate}
        </Label>
      </div>

      <div className="space-y-1.5">
        <Label>{de.letters.senderAddressSelect}</Label>
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
      </div>
    </div>
  );
}
