"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Eye,
  Heading,
  ImagePlus,
  Minus,
  MoveVertical,
  Type,
} from "lucide-react";
import { saveEditorLetterAction, saveTemplateAction, uploadAssetAction } from "../actions";
import { safeParseLetterDocument } from "@/lib/shared/letter-document";
import type { LetterBlock, LetterDocument, LetterTheme } from "@/lib/shared/letter-document";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LetterPreview } from "@/components/letters/letter-preview";
import { LetterCanvas } from "@/components/letters/letter-canvas";
import { BlockInspector } from "@/components/letters/block-inspector";
import { AiDraftDialog } from "@/components/letters/ai-draft-dialog";
import { PLACEHOLDER_KEYS, PLACEHOLDER_LABELS, unknownPlaceholders } from "@/lib/shared/placeholders";
import { sheetsFromPages } from "@/lib/shared/sheets";
import { de } from "@/lib/i18n/de";

type SenderAddress = { id: string; label: string; sender_line: string; is_default: boolean };
type Template = { id: string; name: string; editor_document: unknown };

/**
 * Non-legacy documents are upgraded to the DIN 5008 content frame on open so
 * the body aligns with the address block. Legacy (v1) documents keep their
 * frozen metrics — their stored pagination equals the booked price.
 */
function modernizeMarginStyle(doc: LetterDocument): LetterDocument {
  if (doc.theme.legacyLayout || doc.theme.marginStyle === "din") return doc;
  return { ...doc, theme: { ...doc.theme, marginStyle: "din" } };
}

let blockCounter = 0;
const nextId = () => `b${Date.now()}-${blockCounter++}`;

function newBlock(type: LetterBlock["type"]): LetterBlock {
  switch (type) {
    case "subject":
      return { type: "subject", id: nextId(), text: "", align: "left", color: "default" };
    case "heading":
      return { type: "heading", id: nextId(), text: "", level: 2, align: "left", color: "default" };
    case "text":
      return { type: "text", id: nextId(), text: "", align: "left", sizeDeltaPt: 0, color: "default" };
    case "divider":
      return { type: "divider", id: nextId(), widthPct: 100, thicknessPt: 0.75, color: "muted" };
    case "spacer":
      return { type: "spacer", id: nextId(), heightMm: 8 };
    case "image":
      return { type: "image", id: nextId(), storagePath: "", widthMm: 80, align: "left" };
  }
}

export function LetterEditor({
  letterId,
  initialTitle,
  initialDocument,
  senderAddresses,
  templates,
  letterheads,
  aiMock,
  aiEnabled,
}: {
  letterId: string | null;
  initialTitle: string;
  initialDocument: LetterDocument;
  senderAddresses: SenderAddress[];
  templates: Template[];
  letterheads: Template[];
  aiMock: boolean;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [doc, setDoc] = useState<LetterDocument>(() => modernizeMarginStyle(initialDocument));
  const [savedId, setSavedId] = useState<string | null>(letterId);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [isSaving, startSaving] = useTransition();
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A margin-style upgrade counts as an unsaved change (the stored letter
  // still renders with the old frame until re-saved).
  const [dirty, setDirty] = useState(
    letterId !== null && modernizeMarginStyle(initialDocument) !== initialDocument,
  );
  const [showZones, setShowZones] = useState(false);
  const [showSampleData, setShowSampleData] = useState(false);
  const [zoom, setZoom] = useState<"fit" | "full">("fit");
  const [estimatedPages, setEstimatedPages] = useState(1);
  const activeTextRef = useRef<
    | { kind: "block"; blockId: string; el: HTMLTextAreaElement }
    | { kind: "header" | "footer"; el: HTMLTextAreaElement }
    | null
  >(null);
  // Shown while an auto-upgrade to the DIN frame is unsaved — the stored
  // letter still renders (and is priced) with the old frame until re-saved.
  const marginUpgraded =
    letterId !== null && initialDocument.theme.marginStyle === "classic" && !initialDocument.theme.legacyLayout;
  const imageFileRef = useRef<HTMLInputElement>(null);
  const [isUploadingImage, startImageUpload] = useTransition();

  const hasSender = senderAddresses.length > 0;

  const updateDoc = useCallback((updater: (prev: LetterDocument) => LetterDocument) => {
    setDoc(updater);
    setDirty(true);
  }, []);

  // Unsaved-changes guard.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const senderLine = useMemo(() => {
    const chosen =
      senderAddresses.find((a) => a.id === doc.senderAddressId) ??
      senderAddresses.find((a) => a.is_default) ??
      senderAddresses[0];
    return chosen?.sender_line ?? "";
  }, [doc.senderAddressId, senderAddresses]);

  const recipientLines = useMemo(
    () => ["Muster GmbH", "Frau Erika Mustermann", "Musterstraße 12", "10115 Berlin"],
    [],
  );

  const selectedBlock = doc.blocks.find((b) => b.id === selectedId) ?? null;

  const loadTemplate = (template: Template) => {
    const parsed = safeParseLetterDocument(template.editor_document);
    if (!parsed.success) {
      toast.error(de.letters.templateLoadFailed);
      return;
    }
    const hasContent = doc.blocks.some((b) => "text" in b && b.text.trim().length > 0);
    if (hasContent && !window.confirm(de.letters.templateLoadConfirm)) return;
    updateDoc((prev) =>
      modernizeMarginStyle({ ...parsed.data, senderAddressId: prev.senderAddressId }),
    );
    if (!title.trim()) setTitle(template.name);
    setSelectedId(null);
    toast.success(de.letters.templateLoaded);
  };

  const saveTemplate = () => {
    if (!templateName.trim()) {
      toast.error(de.validation.fieldRequired);
      return;
    }
    startSaving(async () => {
      const result = await saveTemplateAction(null, { name: templateName, document: doc });
      if (result.ok) {
        toast.success(de.letters.saved);
        setTemplateDialogOpen(false);
        setTemplateName("");
      } else {
        toast.error(result.error);
      }
    });
  };

  const updateBlock = useCallback(
    (id: string, patch: Partial<LetterBlock>) => {
      updateDoc((prev) => ({
        ...prev,
        blocks: prev.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as LetterBlock) : b)),
      }));
    },
    [updateDoc],
  );

  const updateTheme = useCallback(
    (patch: Partial<LetterTheme>) => {
      updateDoc((prev) => ({ ...prev, theme: { ...prev.theme, ...patch } }));
    },
    [updateDoc],
  );

  const updateDocFields = useCallback(
    (
      patch: Partial<
        Pick<
          LetterDocument,
          "logoStoragePath" | "header" | "footer" | "showDate" | "senderAddressId"
        >
      >,
    ) => {
      updateDoc((prev) => ({ ...prev, ...patch }));
    },
    [updateDoc],
  );

  /**
   * Applies a saved letterhead: typography, logo, header/footer and date
   * switch — content blocks and the sender address stay. The pagination
   * gates (legacyLayout, marginStyle) of the CURRENT document are preserved
   * so applying a letterhead can never silently re-price a legacy letter.
   */
  const applyLetterhead = (id: string) => {
    const letterhead = letterheads.find((l) => l.id === id);
    if (!letterhead) return;
    const parsed = safeParseLetterDocument(letterhead.editor_document);
    if (!parsed.success) {
      toast.error(de.letters.letterheadLoadFailed);
      return;
    }
    const source = parsed.data;
    updateDoc((prev) => ({
      ...prev,
      theme: {
        ...source.theme,
        legacyLayout: prev.theme.legacyLayout,
        marginStyle: prev.theme.marginStyle,
      },
      logoStoragePath: source.logoStoragePath,
      header: source.header,
      footer: source.footer,
      showDate: source.showDate,
    }));
    toast.success(de.letters.letterheadApplied);
  };

  const saveLetterhead = (name: string) => {
    startSaving(async () => {
      // A letterhead is a content-free document: theme + logo + header/footer.
      const letterheadDoc: LetterDocument = { ...doc, blocks: [] };
      const result = await saveTemplateAction(null, {
        name,
        document: letterheadDoc,
        kind: "letterhead",
      });
      if (result.ok) {
        toast.success(de.letters.letterheadSaved);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  /** Inserts after the selected block (or at the end) and selects the new block. */
  const insertBlock = (block: LetterBlock) => {
    updateDoc((prev) => {
      const idx = prev.blocks.findIndex((b) => b.id === selectedId);
      const at = idx >= 0 ? idx + 1 : prev.blocks.length;
      const blocks = [...prev.blocks];
      blocks.splice(at, 0, block);
      return { ...prev, blocks };
    });
    setSelectedId(block.id);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-block-id="${block.id}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  const addBlock = (type: Exclude<LetterBlock["type"], "image">) => insertBlock(newBlock(type));

  const addImageBlock = (file: File) => {
    startImageUpload(async () => {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadAssetAction(null, formData);
      if (result.ok && result.data) {
        insertBlock({ ...newBlock("image"), storagePath: result.data.path } as LetterBlock);
      } else {
        toast.error(result.ok ? de.common.genericError : result.error);
      }
    });
  };

  const removeBlock = (id: string) => {
    updateDoc((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateBlock = (id: string) => {
    updateDoc((prev) => {
      const idx = prev.blocks.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const copy = { ...prev.blocks[idx], id: nextId() } as LetterBlock;
      const blocks = [...prev.blocks];
      blocks.splice(idx + 1, 0, copy);
      return { ...prev, blocks };
    });
  };

  const moveBlock = (id: string, dir: -1 | 1) =>
    updateDoc((prev) => {
      const idx = prev.blocks.findIndex((b) => b.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.blocks.length) return prev;
      const blocks = [...prev.blocks];
      [blocks[idx], blocks[next]] = [blocks[next], blocks[idx]];
      return { ...prev, blocks };
    });

  const insertPlaceholder = (key: string) => {
    const active = activeTextRef.current;
    if (!active) {
      toast.info(de.letters.placeholdersHint);
      return;
    }
    const token = `{{${key}}}`;
    const el = active.el;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;

    if (active.kind === "block") {
      const block = doc.blocks.find((b) => b.id === active.blockId);
      if (!block || !("text" in block)) return;
      updateBlock(active.blockId, {
        text: block.text.slice(0, start) + token + block.text.slice(end),
      });
    } else if (active.kind === "header") {
      updateDocFields({
        header: { ...doc.header, text: doc.header.text.slice(0, start) + token + doc.header.text.slice(end) },
      });
    } else {
      updateDocFields({
        footer: { text: doc.footer.text.slice(0, start) + token + doc.footer.text.slice(end) },
      });
    }
    // Restore focus and place the caret after the inserted token so a second
    // insert lands at the right position instead of the text end.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        // input types that don't support selection — ignore
      }
    });
  };

  const insertAiDraft = (draft: { betreff: string; absaetze: string[] }) => {
    if (draft.absaetze.length === 0 && !draft.betreff.trim()) return;
    updateDoc((prev) => {
      const blocks = [...prev.blocks];
      // Fill the existing empty subject (default doc) instead of duplicating it.
      const subjectIdx = blocks.findIndex((b) => b.type === "subject" && !b.text.trim());
      if (subjectIdx >= 0) {
        blocks[subjectIdx] = { ...blocks[subjectIdx], text: draft.betreff } as LetterBlock;
      } else {
        blocks.push({ ...newBlock("subject"), text: draft.betreff } as LetterBlock);
      }
      const emptyTextIdx = blocks.findIndex((b) => b.type === "text" && !b.text.trim());
      const paragraphBlocks = draft.absaetze.map(
        (text) => ({ ...newBlock("text"), text }) as LetterBlock,
      );
      if (emptyTextIdx >= 0 && paragraphBlocks.length > 0) {
        blocks.splice(emptyTextIdx, 1, ...paragraphBlocks);
      } else {
        blocks.push(...paragraphBlocks);
      }
      return { ...prev, blocks };
    });
    setSelectedId(null);
  };

  const unknownTokens = useMemo(() => {
    const found = new Set<string>();
    const texts = [
      ...doc.blocks.filter((b) => "text" in b).map((b) => (b as { text: string }).text),
      doc.header.text,
      doc.footer.text,
    ];
    for (const text of texts) {
      for (const t of unknownPlaceholders(text)) found.add(t);
    }
    return [...found];
  }, [doc.blocks, doc.header.text, doc.footer.text]);

  const save = (onSaved?: (id: string) => void) => {
    if (!title.trim()) {
      toast.error(de.validation.fieldRequired);
      return;
    }
    startSaving(async () => {
      const result = await saveEditorLetterAction(null, { id: savedId, title, document: doc });
      if (result.ok && result.data) {
        setSavedId(result.data.letterId);
        setPreviewVersion((v) => v + 1);
        setDirty(false);
        toast.success(de.letters.saved);
        onSaved?.(result.data.letterId);
      } else {
        toast.error(result.ok ? de.letters.saveFailed : result.error);
      }
    });
  };

  const estimatedSheets = sheetsFromPages(estimatedPages, false);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{de.letters.editorTitle}</h1>
          <p className="text-muted-foreground text-sm">{de.letters.editorSubtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <Badge variant="outline" className="border-warning text-warning">
              {de.letters.unsavedChanges}
            </Badge>
          ) : null}
          {aiEnabled ? <AiDraftDialog mock={aiMock} onDraft={insertAiDraft} /> : null}
          {templates.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" />}>
                {de.letters.useTemplate}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {templates.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => loadTemplate(t)}>
                    {t.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
            <DialogTrigger render={<Button variant="ghost" disabled={!hasSender} />}>
              {de.letters.saveAsTemplate}
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>{de.letters.saveAsTemplate}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder={de.letters.templates}
                />
                <Button onClick={saveTemplate} disabled={isSaving} className="w-full">
                  {de.common.save}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={() => save()} disabled={isSaving || !hasSender}>
            {isSaving ? de.common.saving : de.common.save}
          </Button>
          <Button
            onClick={() => save((id) => router.push(`/app/briefe/${id}`))}
            disabled={isSaving || !hasSender}
          >
            {de.common.next}
          </Button>
        </div>
      </div>

      {!hasSender ? (
        <p className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {de.letters.noSenderAddress}
        </p>
      ) : null}

      {marginUpgraded && dirty ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {de.letters.marginUpgradeNotice}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="letter-title">{de.letters.letterName}</Label>
        <Input
          id="letter-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          placeholder={de.letters.letterNamePlaceholder}
          className="max-w-md"
        />
      </div>

      <p className="bg-muted text-muted-foreground rounded-md p-2 text-xs md:hidden">
        {de.letters.mobileReadOnlyHint}
      </p>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* Canvas column */}
        <div className="min-w-0 space-y-3">
          {/* Block palette + canvas toolbar (editing is desktop-only) */}
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            <span className="text-muted-foreground text-xs font-medium">{de.letters.addBlock}:</span>
            <Button variant="outline" size="sm" onClick={() => addBlock("subject")}>
              <Heading className="size-3.5" aria-hidden /> {de.letters.blockSubject}
            </Button>
            <Button variant="outline" size="sm" onClick={() => addBlock("heading")}>
              <Heading className="size-3.5" aria-hidden /> {de.letters.blockHeading}
            </Button>
            <Button variant="outline" size="sm" onClick={() => addBlock("text")}>
              <Type className="size-3.5" aria-hidden /> {de.letters.blockText}
            </Button>
            <Button variant="outline" size="sm" onClick={() => addBlock("divider")}>
              <Minus className="size-3.5" aria-hidden /> {de.letters.blockDivider}
            </Button>
            <Button variant="outline" size="sm" onClick={() => addBlock("spacer")}>
              <MoveVertical className="size-3.5" aria-hidden /> {de.letters.blockSpacer}
            </Button>
            <input
              ref={imageFileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) addImageBlock(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={isUploadingImage}
              onClick={() => imageFileRef.current?.click()}
            >
              <ImagePlus className="size-3.5" aria-hidden /> {de.letters.blockImage}
            </Button>
          </div>

          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <span>
              {de.letters.estimateLabel}: ca. {estimatedPages}{" "}
              {estimatedPages === 1 ? "Seite" : de.letters.pageCount} · {estimatedSheets}{" "}
              {de.letters.sheetCount}
            </span>
            <label className="flex items-center gap-1.5">
              <Switch checked={showZones} onCheckedChange={setShowZones} />
              {de.letters.showZones}
            </label>
            <label className="flex items-center gap-1.5">
              <Switch checked={showSampleData} onCheckedChange={setShowSampleData} />
              {de.letters.sampleDataToggle}
            </label>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setZoom(zoom === "fit" ? "full" : "fit")}
            >
              {zoom === "fit" ? de.letters.zoom100 : de.letters.zoomFit}
            </Button>
            {savedId ? (
              <Dialog>
                <DialogTrigger render={<Button variant="ghost" size="xs" />}>
                  <Eye className="size-3.5" aria-hidden /> {de.letters.pdfPreviewButton}
                </DialogTrigger>
                <DialogContent className="sm:max-w-xl">
                  <DialogHeader>
                    <DialogTitle>{de.letters.pdfPreviewButton}</DialogTitle>
                  </DialogHeader>
                  <LetterPreview letterId={savedId} version={previewVersion} />
                  <p className="text-muted-foreground text-xs">{de.letters.estimateDisclaimer}</p>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>

          <div className="hidden md:block">
            <LetterCanvas
              doc={doc}
              senderLine={senderLine}
              recipientLines={recipientLines}
              selectedId={selectedId}
              readOnly={false}
              showZones={showZones}
              showSampleData={showSampleData}
              zoom={zoom}
              onSelect={setSelectedId}
              onChangeBlock={updateBlock}
              onMoveBlock={moveBlock}
              onRemoveBlock={removeBlock}
              onDuplicateBlock={duplicateBlock}
              onFocusText={(blockId, el) => (activeTextRef.current = { kind: "block", blockId, el })}
              onEstimate={setEstimatedPages}
            />
          </div>
          <div className="md:hidden">
            <LetterCanvas
              doc={doc}
              senderLine={senderLine}
              recipientLines={recipientLines}
              selectedId={selectedId}
              readOnly
              showZones={false}
              showSampleData={showSampleData}
              zoom="fit"
              onSelect={setSelectedId}
              onChangeBlock={updateBlock}
              onMoveBlock={moveBlock}
              onRemoveBlock={removeBlock}
              onDuplicateBlock={duplicateBlock}
              onFocusText={() => undefined}
              onEstimate={setEstimatedPages}
            />
          </div>

          {/* Placeholder chips (Serienbrief) */}
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">{de.letters.placeholdersHint}</p>
            <div className="hidden flex-wrap gap-2 md:flex">
              {PLACEHOLDER_KEYS.map((key) => (
                <Button
                  key={key}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => insertPlaceholder(key)}
                >
                  {PLACEHOLDER_LABELS[key]}
                </Button>
              ))}
            </div>
            {unknownTokens.length > 0 ? (
              <p className="text-warning text-xs">
                {de.letters.unknownPlaceholderWarning}{" "}
                {unknownTokens.map((t) => `{{${t}}}`).join(", ")}
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">{de.letters.perRecipientHint}</p>
          </div>
        </div>

        {/* Inspector column */}
        <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
          <BlockInspector
            doc={doc}
            selected={selectedBlock}
            senderAddresses={senderAddresses}
            letterheads={letterheads.map((l) => ({ id: l.id, name: l.name }))}
            onChangeBlock={updateBlock}
            onChangeTheme={updateTheme}
            onChangeDoc={updateDocFields}
            onApplyLetterhead={applyLetterhead}
            onSaveLetterhead={saveLetterhead}
            onFocusChromeText={(kind, el) => (activeTextRef.current = { kind, el })}
          />
        </div>
      </div>
    </div>
  );
}
