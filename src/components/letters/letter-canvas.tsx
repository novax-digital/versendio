"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BlockInsertMenuContent } from "@/components/letters/block-insert-menu";
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
  buildDateLine,
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
// Gap between page sheets in the Word-like multi-page view.
const PAGE_GAP_PX = 28;

/** Shallow numeric equality for the per-block page offset map. */
function sameOffsets(a: Record<string, number>, b: Record<string, number>) {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

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
  senderCity?: string | null;
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
  /** Drag-reorder (dnd-kit); arrows in the gutter remain the fallback. */
  onReorderBlock?: (from: number, to: number) => void;
  /** Gap inserter between blocks. */
  onInsertBlockAt?: (type: Exclude<LetterBlock["type"], "image">, at: number) => void;
  onInsertImageAt?: (at: number) => void;
};

export function LetterCanvas({
  doc,
  senderLine,
  senderCity,
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
  onReorderBlock,
  onInsertBlockAt,
  onInsertImageAt,
}: CanvasProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.75);
  // Word-like pagination: how many A4 sheets to draw, plus the extra top margin
  // pushed onto each block that starts a new page so content lands on its sheet.
  const [pageCount, setPageCount] = useState(1);
  const [blockOffsets, setBlockOffsets] = useState<Record<string, number>>({});
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

  // Word-like pagination. Measure rendered block heights (layout px are
  // unaffected by the sheet transform) and replay the renderer's cursor math,
  // but in the multi-sheet coordinate space: each block that starts a new page
  // gets an extra top margin that pushes it down onto the next sheet (across the
  // inter-page gap). Because margins are excluded from offsetHeight, adding them
  // never changes the measured heights — so this converges in one extra pass.
  const measure = useCallback(() => {
    const content = contentRef.current;
    // A display:none instance (responsive twin) measures 0 heights — skip.
    if (!content || content.offsetParent === null) return;
    const children = Array.from(content.children) as HTMLElement[];

    const bodyStartPx = frame.bodyStartMm * MM_PX;
    const followTopPx = frame.followTopMm * MM_PX;
    const bottomPx = frame.bottomMm * MM_PX;
    const step = SHEET_H_PX + PAGE_GAP_PX;
    // Column-offset (px, 0 = column top which sits at bodyStartPx on sheet 0).
    const pageBottomO = (p: number) => p * step + bottomPx - bodyStartPx;
    const pageTopO = (p: number) => p * step + followTopPx - bodyStartPx;

    let page = 0;
    let o = 0; // column-offset of the current block's top (offsets applied)
    let cardTopO = 0; // column-offset of the current sheet's content top
    let pendingBreak = false;
    const offsets: Record<string, number> = {};

    for (const child of children) {
      const h = child.offsetHeight;
      if (h <= 0) continue;
      const id = child.dataset.blockId;
      const mb = parseFloat(getComputedStyle(child).marginBottom) || 0;

      if (pendingBreak || (o + h > pageBottomO(page) && o > cardTopO)) {
        page += 1;
        const push = Math.max(0, pageTopO(page) - o);
        if (id && push > 0.5) offsets[id] = push;
        o += push;
        cardTopO = o;
        pendingBreak = false;
      }
      // A single block taller than a page: add sheets to cover it.
      while (o + h > pageBottomO(page)) page += 1;

      o += h + mb;
      if (child.dataset.blockType === "pagebreak") pendingBreak = true;
    }

    const nextCount = page + 1;
    setPageCount((prev) => (prev === nextCount ? prev : nextCount));
    setBlockOffsets((prev) => (sameOffsets(prev, offsets) ? prev : offsets));
    onEstimate?.(nextCount);
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

  const totalHeight = pageCount * SHEET_H_PX + (pageCount - 1) * PAGE_GAP_PX;

  return (
    <div ref={containerRef} className={cn("w-full", zoom === "full" && "overflow-x-auto")}>
      {/* Width-clamped wrapper so the scaled sheet stack centers in the well. */}
      <div className="mx-auto" style={{ height: totalHeight * scale, width: SHEET_W_PX * scale }}>
        <div
          className="letter-canvas-text relative origin-top-left text-black"
          style={{
            width: SHEET_W_PX,
            height: totalHeight,
            transform: `scale(${scale})`,
          }}
          onClick={() => onSelect(null)}
        >
          {/* Page sheets: one white A4 card per page, stacked with a gap so a
              multi-page letter reads like separate sheets (Word-style). */}
          {Array.from({ length: pageCount }, (_, i) => (
            <div
              key={i}
              className="absolute left-0 bg-white ring-1 ring-black/5 dark:ring-white/10"
              style={{
                top: i * (SHEET_H_PX + PAGE_GAP_PX),
                width: SHEET_W_PX,
                height: SHEET_H_PX,
                boxShadow: "0 1px 2px rgba(16,24,40,.06), 0 16px 40px -12px rgba(16,24,40,.22)",
              }}
            />
          ))}

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
          {doc.footer.text.trim() && pageCount <= 1 ? (
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
              {buildDateLine(doc.dateStyle, doc.dateWithPlace, senderCity)}
            </div>
          ) : null}

          {/* Content column */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            accessibility={{
              screenReaderInstructions: { draggable: de.letters.dragSrInstructions },
              announcements: {
                onDragStart: () => de.letters.dragStarted,
                onDragOver: () => de.letters.dragOver,
                onDragEnd: () => de.letters.dragDropped,
                onDragCancel: () => de.letters.dragCanceled,
              },
            }}
            onDragEnd={(e: DragEndEvent) => {
              const { active, over } = e;
              if (!over || active.id === over.id || !onReorderBlock) return;
              const from = doc.blocks.findIndex((b) => b.id === active.id);
              const to = doc.blocks.findIndex((b) => b.id === over.id);
              if (from >= 0 && to >= 0) onReorderBlock(from, to);
            }}
          >
            <SortableContext
              items={doc.blocks.map((b) => b.id)}
              strategy={verticalListSortingStrategy}
            >
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
                    offset={blockOffsets[block.id] ?? 0}
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
                    onInsertBlockAt={onInsertBlockAt}
                    onInsertImageAt={onInsertImageAt}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

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
              {pageCount <= 1 ? (
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
  offset,
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
  onInsertBlockAt,
  onInsertImageAt,
}: {
  block: LetterBlock;
  doc: LetterDocument;
  index: number;
  total: number;
  offset: number;
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
  onInsertBlockAt?: (type: Exclude<LetterBlock["type"], "image">, at: number) => void;
  onInsertImageAt?: (at: number) => void;
}) {
  const theme = doc.theme;
  const fontStack = LETTER_FONTS[theme.fontFamily].cssStack;
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    isDragging,
  } = useSortable({ id: block.id, disabled: readOnly });
  // Sortable transforms are computed from screen-space (scaled) rects but are
  // applied INSIDE the transform-scaled sheet — divide by the scale so drag
  // deltas and sibling displacement match visually (I-011 inverse-scale).
  // Applied only while a drag is active, so resting layout px stay mm-exact.
  const dragStyle: React.CSSProperties = transform
    ? {
        transform: `translate3d(0, ${transform.y / scale}px, 0)`,
        zIndex: isDragging ? 20 : undefined,
        opacity: isDragging ? 0.85 : undefined,
      }
    : {};

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
  } else if (block.type === "pagebreak") {
    marginBottomPx = 0;
    body = (
      <div
        className={cn(
          "flex items-center gap-2 py-2 text-[10px] font-medium tracking-wide uppercase",
          selected ? "text-primary/70" : "text-slate-400",
        )}
      >
        <span className="flex-1 border-t border-dashed border-current" />
        {de.letters.blockPageBreak}
        <span className="flex-1 border-t border-dashed border-current" />
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
      ref={setNodeRef}
      className={cn(
        "group/block relative -mx-1 rounded-sm px-1 transition-shadow",
        selected
          ? "ring-primary/70 ring-2"
          : "hover:ring-1 hover:ring-slate-300",
      )}
      style={{ marginTop: offset || undefined, marginBottom: marginBottomPx, ...dragStyle }}
      onClick={select}
      data-block-id={block.id}
      data-block-type={block.type}
    >
      {body}
      {/* Gap inserter: zero-height hover zones straddling the block edges. */}
      {!readOnly && onInsertBlockAt && onInsertImageAt ? (
        <>
          {index === 0 ? (
            <GapInserter
              at={0}
              position="top"
              scale={scale}
              onInsert={onInsertBlockAt}
              onInsertImage={onInsertImageAt}
            />
          ) : null}
          <GapInserter
            at={index + 1}
            position="bottom"
            scale={scale}
            onInsert={onInsertBlockAt}
            onInsertImage={onInsertImageAt}
          />
        </>
      ) : null}
      {!readOnly ? (
        <div
          className={cn(
            "absolute top-0 -left-12 z-10 origin-top-right transition-opacity",
            selected
              ? "opacity-100"
              : "opacity-0 group-focus-within/block:opacity-100 group-hover/block:opacity-70",
          )}
          onFocus={() => onSelect(block.id)}
          style={{ transform: `scale(${Math.min(1.6, Math.max(1, 1 / scale))})` }}
        >
          <div className="bg-background flex flex-col items-center gap-0.5 rounded-md border p-0.5 shadow-sm">
            <button
              ref={setActivatorNodeRef}
              type="button"
              aria-label={de.letters.dragToMove}
              title={de.letters.dragToMove}
              className="text-muted-foreground hover:text-foreground flex size-7 cursor-grab items-center justify-center rounded active:cursor-grabbing"
              {...listeners}
              {...attributes}
            >
              <GripVertical className="size-3.5" aria-hidden />
            </button>
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

/**
 * Hover-revealed insertion affordance between blocks: a zero-layout-height
 * absolute zone that shows a Kurierblau line + centered "+" menu on hover.
 * Pure CSS reveal (group-hover) — no React hover state, no mm impact.
 */
function GapInserter({
  at,
  position,
  scale,
  onInsert,
  onInsertImage,
}: {
  at: number;
  position: "top" | "bottom";
  scale: number;
  onInsert: (type: Exclude<LetterBlock["type"], "image">, at: number) => void;
  onInsertImage: (at: number) => void;
}) {
  return (
    // The outer band is pointer-transparent so caret clicks at block
    // boundaries reach the textareas; only the small centered hotspot is
    // interactive. Opacity (not display) reveal keeps the trigger tabbable.
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 flex h-4 items-center justify-center",
        position === "top" ? "-top-2" : "-bottom-2",
      )}
    >
      <div
        className="group/gap pointer-events-auto flex h-4 w-16 items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-primary/50 absolute inset-x-0 top-1/2 h-px opacity-0 group-focus-within/gap:opacity-100 group-hover/gap:opacity-100" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={de.letters.insertBlockHere}
                title={de.letters.insertBlockHere}
                className="bg-primary text-primary-foreground hover:bg-primary-hover relative flex size-5 items-center justify-center rounded-full opacity-0 shadow-sm group-hover/gap:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                style={{ transform: `scale(${Math.min(1.6, Math.max(1, 1 / scale))})` }}
              />
            }
          >
            <Plus className="size-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <BlockInsertMenuContent
            align="center"
            onInsert={(type) => onInsert(type, at)}
            onInsertImage={() => onInsertImage(at)}
          />
        </DropdownMenu>
      </div>
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
