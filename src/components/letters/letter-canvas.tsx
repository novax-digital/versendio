"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { A4, ZONES } from "@/lib/shared/schablone";
import {
  LETTERHEAD,
  MUTED_COLOR,
  contentFrame,
  dividerMetrics,
  resolveTextStyle,
} from "@/lib/shared/letter-style";
import { LETTER_FONTS } from "@/lib/shared/letter-fonts";
import type { LetterBlock, LetterDocument } from "@/lib/shared/letter-document";
import {
  formatLetterDate,
  resolvePlaceholders,
  type PlaceholderContext,
} from "@/lib/shared/placeholders";
import { ZoneOverlay } from "@/components/letters/zone-overlay";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { de } from "@/lib/i18n/de";

/**
 * WYSIWYG A4 canvas: a fixed-pixel sheet (96dpi) scaled to the container via
 * transform. Text blocks are borderless textareas styled with the exact
 * typography the PDF renderer uses (same TTFs, same mm metrics from
 * letter-style.ts), so what you see closely matches the printed letter.
 * The sheet grows with content; the server-side PDF stays authoritative for
 * pagination ("Versand-Vorschau").
 */

const MM_PX = 96 / 25.4; // 3.7795 px per mm at CSS 96dpi
const SHEET_W_PX = A4.widthMm * MM_PX; // 793.7
const SHEET_H_PX = A4.heightMm * MM_PX; // 1122.5
const PT_PX = 96 / 72; // 1.3333 px per typographic point

export const SAMPLE_PLACEHOLDERS: PlaceholderContext = {
  anrede: "Frau",
  vorname: "Erika",
  nachname: "Mustermann",
  firma: "Muster GmbH",
  strasse: "Musterstraße 12",
  plz: "10115",
  ort: "Berlin",
  land: "",
  datum: formatLetterDate(),
};

export type CanvasProps = {
  doc: LetterDocument;
  senderLine: string;
  recipientLines: string[];
  selectedId: string | null;
  readOnly: boolean;
  showZones: boolean;
  showSampleData: boolean;
  zoom: "fit" | "full";
  onSelect: (id: string | null) => void;
  onChangeBlock: (id: string, patch: Partial<LetterBlock>) => void;
  onMoveBlock: (id: string, dir: -1 | 1) => void;
  onRemoveBlock: (id: string) => void;
  onDuplicateBlock: (id: string) => void;
  onFocusText: (blockId: string, el: HTMLTextAreaElement) => void;
  onEstimate?: (pages: number) => void;
  /** Sheet chrome-zone click (header/footer band) → open the matching inspector section. */
  onEditChrome?: (kind: "header" | "footer") => void;
};

export function LetterCanvas({
  doc,
  senderLine,
  recipientLines,
  selectedId,
  readOnly,
  showZones,
  showSampleData,
  zoom,
  onSelect,
  onChangeBlock,
  onMoveBlock,
  onRemoveBlock,
  onDuplicateBlock,
  onFocusText,
  onEstimate,
  onEditChrome,
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.75);
  const [sheetHeight, setSheetHeight] = useState(SHEET_H_PX);
  // Bumped when @font-face letter fonts finish loading so textarea heights
  // and the page estimate re-measure with real metrics.
  const [fontTick, setFontTick] = useState(0);

  useEffect(() => {
    const onFonts = () => setFontTick((t) => t + 1);
    document.fonts?.addEventListener("loadingdone", onFonts);
    return () => document.fonts?.removeEventListener("loadingdone", onFonts);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth;
      setScale(zoom === "full" ? 1 : Math.min(1, width / SHEET_W_PX));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [zoom]);

  const theme = doc.theme;
  const frame = contentFrame(theme);

  // Page estimate + sheet growth: measure rendered block heights (layout px
  // are unaffected by the transform) and replay the renderer's cursor math.
  const measure = useCallback(() => {
    const content = contentRef.current;
    // A display:none instance (responsive twin) measures 0 heights — skip.
    if (!content || content.offsetParent === null) return;
    const children = Array.from(content.children) as HTMLElement[];
    let cursorMm = frame.bodyStartMm;
    let pages = 1;
    for (const child of children) {
      let hMm = child.offsetHeight / MM_PX;
      if (hMm <= 0) continue;
      if (cursorMm + hMm > frame.bottomMm && cursorMm > frame.followTopMm) {
        pages += 1;
        cursorMm = frame.followTopMm;
      }
      // A single block taller than a page spills across several pages.
      while (cursorMm + hMm > frame.bottomMm) {
        hMm -= frame.bottomMm - cursorMm;
        pages += 1;
        cursorMm = frame.followTopMm;
      }
      cursorMm += hMm;
    }
    onEstimate?.(pages);
    const contentBottomPx = frame.bodyStartMm * MM_PX + content.offsetHeight;
    setSheetHeight(Math.max(SHEET_H_PX, contentBottomPx + 20 * MM_PX));
  }, [onEstimate, frame]);

  useEffect(() => {
    measure();
  });

  const fontStack = LETTER_FONTS[theme.fontFamily].cssStack;

  const mm = (v: number) => v * MM_PX;
  const logoRight = doc.header.logoAlign === "right";
  const headerTextWidthMm = doc.logoStoragePath
    ? frame.widthMm - LETTERHEAD.logo.maxWidthMm - LETTERHEAD.gapMm
    : frame.widthMm;

  return (
    <div ref={containerRef} className={cn("w-full", zoom === "full" && "overflow-x-auto")}>
      {/* Width-clamped wrapper so the scaled sheet centers in the well. */}
      <div className="mx-auto" style={{ height: sheetHeight * scale, width: SHEET_W_PX * scale }}>
        <div
          className="letter-canvas-text relative origin-top-left bg-white text-black ring-1 ring-black/5 dark:ring-white/10"
          style={{
            width: SHEET_W_PX,
            height: sheetHeight,
            transform: `scale(${scale})`,
            boxShadow: "0 1px 2px rgba(16,24,40,.06), 0 16px 40px -12px rgba(16,24,40,.22)",
          }}
          onClick={() => onSelect(null)}
        >
          {/* Logo */}
          {doc.logoStoragePath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/app/briefe/assets/${doc.logoStoragePath}`}
              alt={de.letters.logo}
              className={cn(
                "absolute object-contain",
                logoRight ? "object-right-top" : "object-left-top",
              )}
              style={{
                ...(logoRight
                  ? { right: mm(A4.widthMm - frame.rightMm) }
                  : { left: mm(frame.leftMm) }),
                top: mm(LETTERHEAD.logo.topMm),
                maxWidth: mm(LETTERHEAD.logo.maxWidthMm),
                maxHeight: mm(LETTERHEAD.logo.maxHeightMm),
              }}
            />
          ) : null}

          {/* Header contact block (opposite the logo) */}
          {doc.header.text.trim() ? (
            <div
              className="absolute overflow-hidden whitespace-pre-wrap"
              style={{
                ...(doc.logoStoragePath && logoRight
                  ? { left: mm(frame.leftMm), textAlign: "left" as const }
                  : { right: mm(A4.widthMm - frame.rightMm), textAlign: "right" as const }),
                top: mm(LETTERHEAD.header.topMm),
                width: mm(headerTextWidthMm),
                maxHeight: mm(LETTERHEAD.header.maxLines * LETTERHEAD.header.lineMm),
                fontFamily: fontStack,
                fontSize: LETTERHEAD.header.sizePt * PT_PX,
                lineHeight: `${mm(LETTERHEAD.header.lineMm)}px`,
              }}
            >
              {showSampleData
                ? resolvePlaceholders(doc.header.text, SAMPLE_PLACEHOLDERS)
                : doc.header.text}
            </div>
          ) : null}

          {/* Footer small print (page 1, fixed band below the body flow).
              Hidden once the sheet grows past page 1 — the band belongs to
              page 1 and would otherwise overlay flowing body text. */}
          {doc.footer.text.trim() && sheetHeight <= SHEET_H_PX + 1 ? (
            <div
              className="absolute overflow-hidden text-center whitespace-pre-wrap"
              style={{
                left: mm(frame.leftMm),
                top: mm(LETTERHEAD.footer.topMm),
                width: mm(frame.widthMm),
                maxHeight: mm(LETTERHEAD.footer.maxLines * LETTERHEAD.footer.lineMm),
                color: MUTED_COLOR,
                fontFamily: fontStack,
                fontSize: LETTERHEAD.footer.sizePt * PT_PX,
                lineHeight: `${mm(LETTERHEAD.footer.lineMm)}px`,
              }}
            >
              {showSampleData
                ? resolvePlaceholders(doc.footer.text, SAMPLE_PLACEHOLDERS)
                : doc.footer.text}
            </div>
          ) : null}

          {/* Sender line (Schablone zone, always Helvetica 8pt) */}
          <div
            className="absolute truncate text-black/80"
            style={{
              left: mm(ZONES.senderLine.x + 2),
              top: mm(ZONES.senderLine.y + 0.5),
              width: mm(ZONES.senderLine.width - 4),
              fontFamily: "Helvetica, Arial, sans-serif",
              fontSize: 8 * PT_PX,
              lineHeight: `${mm(4)}px`,
            }}
          >
            {senderLine}
          </div>

          {/* Recipient block (sample data) */}
          <div
            className="absolute"
            style={{
              left: mm(ZONES.recipient.x + 2),
              top: mm(ZONES.recipient.y + 2),
              width: mm(ZONES.recipient.width - 4),
              fontFamily: "Helvetica, Arial, sans-serif",
              fontSize: 9 * PT_PX,
              lineHeight: `${mm(3.5)}px`,
            }}
          >
            {recipientLines.slice(0, 6).map((line, i) => (
              <div key={i} className="truncate">
                {line}
              </div>
            ))}
          </div>

          {/* Date */}
          {doc.showDate ? (
            <div
              className="absolute text-right"
              style={{
                right: mm(A4.widthMm - frame.rightMm),
                top: mm(ZONES.addressBlock.y + ZONES.addressBlock.height + 2),
                fontFamily: fontStack,
                fontSize: 10 * PT_PX,
              }}
            >
              {formatLetterDate()}
            </div>
          ) : null}

          {/* Content column */}
          <div
            ref={contentRef}
            className="absolute"
            style={{
              left: mm(frame.leftMm),
              top: mm(frame.bodyStartMm),
              width: mm(frame.widthMm),
            }}
          >
            {doc.blocks.map((block, index) => (
              <CanvasBlock
                key={block.id}
                block={block}
                doc={doc}
                index={index}
                total={doc.blocks.length}
                selected={selectedId === block.id}
                readOnly={readOnly}
                showSampleData={showSampleData}
                scale={scale}
                fontTick={fontTick}
                onSelect={onSelect}
                onChangeBlock={onChangeBlock}
                onMoveBlock={onMoveBlock}
                onRemoveBlock={onRemoveBlock}
                onDuplicateBlock={onDuplicateBlock}
                onFocusText={onFocusText}
              />
            ))}
          </div>

          {/* Page-1 boundary hint when the sheet grew */}
          {sheetHeight > SHEET_H_PX + 1 ? (
            <div
              className="pointer-events-none absolute left-0 w-full border-t border-dashed border-slate-300"
              style={{ top: SHEET_H_PX }}
            />
          ) : null}

          {/* Clickable letterhead chrome zones — screen-only overlays that open
              the "Kopf & Fuß" inspector section and focus the matching field. */}
          {!readOnly && onEditChrome ? (
            <>
              <button
                type="button"
                aria-label={de.letters.editHeaderZone}
                className="group/chrome absolute z-[5] cursor-pointer rounded-sm hover:outline-dashed hover:outline-1 hover:outline-primary/50"
                style={{
                  left: mm(frame.leftMm),
                  top: mm(6),
                  width: mm(frame.widthMm),
                  height: mm(LETTERHEAD.header.topMm + 26),
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditChrome("header");
                }}
              >
                <span
                  className="bg-background text-foreground absolute top-1 left-1 hidden rounded border px-1.5 py-0.5 text-xs shadow-sm group-hover/chrome:block"
                  style={{ transform: `scale(${Math.min(1.6, Math.max(1, 1 / scale))})`, transformOrigin: "top left" }}
                >
                  {de.letters.editHeaderZone}
                </span>
              </button>
              {sheetHeight <= SHEET_H_PX + 1 ? (
                <button
                  type="button"
                  aria-label={de.letters.editFooterZone}
                  className="group/chrome absolute z-[5] cursor-pointer rounded-sm hover:outline-dashed hover:outline-1 hover:outline-primary/50"
                  style={{
                    left: mm(frame.leftMm),
                    top: mm(LETTERHEAD.footer.topMm - 2),
                    width: mm(frame.widthMm),
                    height: mm(16),
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditChrome("footer");
                  }}
                >
                  <span
                    className="bg-background text-foreground absolute top-1 left-1 hidden rounded border px-1.5 py-0.5 text-xs shadow-sm group-hover/chrome:block"
                    style={{ transform: `scale(${Math.min(1.6, Math.max(1, 1 / scale))})`, transformOrigin: "top left" }}
                  >
                    {de.letters.editFooterZone}
                  </span>
                </button>
              ) : null}
            </>
          ) : null}

          <ZoneOverlay show={showZones} />
        </div>
      </div>
    </div>
  );
}

function CanvasBlock({
  block,
  doc,
  index,
  total,
  selected,
  readOnly,
  showSampleData,
  scale,
  fontTick,
  onSelect,
  onChangeBlock,
  onMoveBlock,
  onRemoveBlock,
  onDuplicateBlock,
  onFocusText,
}: {
  block: LetterBlock;
  doc: LetterDocument;
  index: number;
  total: number;
  selected: boolean;
  readOnly: boolean;
  showSampleData: boolean;
  scale: number;
  fontTick: number;
  onSelect: (id: string | null) => void;
  onChangeBlock: (id: string, patch: Partial<LetterBlock>) => void;
  onMoveBlock: (id: string, dir: -1 | 1) => void;
  onRemoveBlock: (id: string) => void;
  onDuplicateBlock: (id: string) => void;
  onFocusText: (blockId: string, el: HTMLTextAreaElement) => void;
}) {
  const theme = doc.theme;
  const fontStack = LETTER_FONTS[theme.fontFamily].cssStack;

  const select = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(block.id);
  };

  let body: React.ReactNode = null;
  let marginBottomPx = 0;

  if (block.type === "subject" || block.type === "heading" || block.type === "text") {
    const style = resolveTextStyle(block, theme);
    marginBottomPx = style.spacingAfterMm * MM_PX;
    const textStyle: React.CSSProperties = {
      fontFamily: fontStack,
      fontSize: style.sizePt * PT_PX,
      lineHeight: `${style.lineMm * MM_PX}px`,
      fontWeight: style.bold ? 700 : 400,
      color: style.colorHex,
      textAlign: style.align,
    };
    const placeholder =
      block.type === "subject"
        ? de.letters.blockSubject
        : block.type === "heading"
          ? de.letters.blockHeadingPlaceholder
          : de.letters.blockText;
    if (readOnly || showSampleData) {
      const text = showSampleData
        ? resolvePlaceholders(block.text, SAMPLE_PLACEHOLDERS)
        : block.text;
      body = (
        <div className="whitespace-pre-wrap [overflow-wrap:anywhere]" style={textStyle}>
          {text || " "}
        </div>
      );
    } else {
      body = (
        <AutoGrowTextarea
          value={block.text}
          placeholder={placeholder}
          fontTick={fontTick}
          style={textStyle}
          onChange={(value) => onChangeBlock(block.id, { text: value })}
          onFocus={(el) => {
            onSelect(block.id);
            onFocusText(block.id, el);
          }}
        />
      );
    }
  } else if (block.type === "divider") {
    const metrics = dividerMetrics(block, theme);
    marginBottomPx = 0;
    body = (
      <div style={{ padding: `${metrics.spacingMm * MM_PX}px 0` }}>
        <div
          style={{
            width: metrics.widthMm * MM_PX,
            height: Math.max(1, metrics.thicknessMm * MM_PX),
            backgroundColor: block.color === "accent" ? theme.accentColor : "#94A3B8",
          }}
        />
      </div>
    );
  } else if (block.type === "spacer") {
    body = (
      <div
        className={cn(
          "flex items-center justify-center text-[10px]",
          selected ? "bg-primary/5 text-primary/60" : "text-transparent",
        )}
        style={{ height: block.heightMm * MM_PX }}
      >
        {de.letters.blockSpacer} · {block.heightMm} mm
      </div>
    );
  } else if (block.type === "image") {
    marginBottomPx = 2 * MM_PX;
    const width = Math.min(block.widthMm, contentFrame(theme).widthMm) * MM_PX;
    body = (
      <div
        style={{
          display: "flex",
          justifyContent:
            block.align === "center" ? "center" : block.align === "right" ? "flex-end" : "flex-start",
        }}
      >
        <CanvasImage storagePath={block.storagePath} width={width} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group/block relative -mx-1 rounded-sm px-1 transition-shadow",
        selected
          ? "ring-primary/70 ring-2"
          : "hover:ring-1 hover:ring-slate-300",
      )}
      style={{ marginBottom: marginBottomPx }}
      onClick={select}
      data-block-id={block.id}
    >
      {body}
      {!readOnly ? (
        <div
          className={cn(
            "absolute top-0 -left-12 z-10 origin-top-right transition-opacity",
            selected ? "opacity-100" : "opacity-0 group-hover/block:opacity-70",
          )}
          style={{ transform: `scale(${Math.min(1.6, Math.max(1, 1 / scale))})` }}
        >
          <div className="bg-background flex flex-col items-center gap-0.5 rounded-md border p-0.5 shadow-sm">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={index === 0}
              aria-label={de.letters.moveUp}
              title={de.letters.moveUp}
              onClick={(e) => {
                e.stopPropagation();
                onMoveBlock(block.id, -1);
              }}
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={index === total - 1}
              aria-label={de.letters.moveDown}
              title={de.letters.moveDown}
              onClick={(e) => {
                e.stopPropagation();
                onMoveBlock(block.id, 1);
              }}
            >
              <ArrowDown className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={de.letters.duplicateBlock}
              title={de.letters.duplicateBlock}
              onClick={(e) => {
                e.stopPropagation();
                onDuplicateBlock(block.id);
              }}
            >
              <Copy className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-destructive"
              aria-label={de.letters.removeBlock}
              title={de.letters.removeBlock}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveBlock(block.id);
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CanvasImage({ storagePath, width }: { storagePath: string; width: number }) {
  const [failed, setFailed] = useState(false);
  if (!storagePath || failed) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center rounded border border-dashed text-xs"
        style={{ width, minHeight: 40 }}
      >
        {de.letters.imageLoadError}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/app/briefe/assets/${storagePath}`}
      alt={de.letters.blockImage}
      style={{ width }}
      onError={() => setFailed(true)}
    />
  );
}

function AutoGrowTextarea({
  value,
  placeholder,
  fontTick,
  style,
  onChange,
  onFocus,
}: {
  value: string;
  placeholder: string;
  fontTick: number;
  style: React.CSSProperties;
  onChange: (value: string) => void;
  onFocus: (el: HTMLTextAreaElement) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, style.fontSize, style.lineHeight, style.fontFamily, fontTick, resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      rows={1}
      spellCheck={false}
      className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:text-slate-400 focus:ring-0 [overflow-wrap:anywhere]"
      style={style}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => onFocus(e.currentTarget)}
    />
  );
}

export { MM_PX, SHEET_W_PX, SHEET_H_PX };
