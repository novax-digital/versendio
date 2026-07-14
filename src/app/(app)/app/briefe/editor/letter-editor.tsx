"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Ellipsis,
  Eye,
  FileStack,
  FileText,
  Frame,
  Info,
  LayoutTemplate,
  PenLine,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import {
  saveEditorLetterAction,
  saveTemplateAction,
  saveTemplateDocAction,
  uploadAssetAction,
} from "../actions";
import { safeParseLetterDocument } from "@/lib/shared/letter-document";
import type { LetterBlock, LetterDocument, LetterTheme } from "@/lib/shared/letter-document";
import type { DraftBlock } from "@/lib/server/ai/draft-provider";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LetterPreview } from "@/components/letters/letter-preview";
import { LetterCanvas } from "@/components/letters/letter-canvas";
import { BlockInspector } from "@/components/letters/block-inspector";
import { BlockInsertMenuContent } from "@/components/letters/block-insert-menu";
import { AiDraftDialog } from "@/components/letters/ai-draft-dialog";
import { PLACEHOLDER_KEYS, PLACEHOLDER_LABELS, unknownPlaceholders } from "@/lib/shared/placeholders";
import { sheetsFromPages } from "@/lib/shared/sheets";
import { cn } from "@/lib/utils";
import { de } from "@/lib/i18n/de";

type SenderAddress = {
  id: string;
  label: string;
  sender_line: string;
  city: string | null;
  is_default: boolean;
};
type Template = { id: string; name: string; editor_document: unknown };

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
    case "pagebreak":
      return { type: "pagebreak", id: nextId() };
    case "image":
      return { type: "image", id: nextId(), storagePath: "", widthMm: 80, align: "left" };
  }
}

/**
 * Non-legacy documents are upgraded to the DIN 5008 content frame on open so
 * the body aligns with the address block. Legacy (v1) documents keep their
 * frozen metrics — their stored pagination equals the booked price.
 */
function modernizeMarginStyle(doc: LetterDocument): LetterDocument {
  if (doc.theme.legacyLayout || doc.theme.marginStyle === "din") return doc;
  return { ...doc, theme: { ...doc.theme, marginStyle: "din" } };
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
  templateMode = false,
  templateId = null,
}: {
  letterId: string | null;
  initialTitle: string;
  initialDocument: LetterDocument;
  senderAddresses: SenderAddress[];
  templates: Template[];
  letterheads: Template[];
  aiMock: boolean;
  aiEnabled: boolean;
  /** When true the editor edits a reusable template, not a sendable letter:
   *  Save writes to letter_templates and the send/preview affordances are hidden. */
  templateMode?: boolean;
  /** Existing template id when editing; null when creating a new template. */
  templateId?: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [doc, setDoc] = useState<LetterDocument>(() => modernizeMarginStyle(initialDocument));
  const [savedId, setSavedId] = useState<string | null>(letterId);
  const [savedTemplateId, setSavedTemplateId] = useState<string | null>(templateId);
  // The id of the persisted record for the current mode (letter or template).
  const persistedId = templateMode ? savedTemplateId : savedId;
  const [previewVersion, setPreviewVersion] = useState(0);
  const [isSaving, startSaving] = useTransition();
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [pendingTemplate, setPendingTemplate] = useState<Template | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A margin-style upgrade counts as an unsaved change (the stored letter
  // still renders with the old frame until re-saved).
  const [dirty, setDirty] = useState(
    letterId !== null && modernizeMarginStyle(initialDocument) !== initialDocument,
  );
  const [titleInvalid, setTitleInvalid] = useState(false);
  const [showZones, setShowZones] = useState(false);
  const [showSampleData, setShowSampleData] = useState(false);
  const [zoom, setZoom] = useState<"fit" | "full">("fit");
  const [estimatedPages, setEstimatedPages] = useState(1);
  const [forceOpenHeaderFooter, setForceOpenHeaderFooter] = useState(0);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const bypassGuardRef = useRef(false);
  const activeTextRef = useRef<
    | { kind: "block"; blockId: string; el: HTMLTextAreaElement }
    | { kind: "header" | "footer"; el: HTMLTextAreaElement }
    | null
  >(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const wellImageRef = useRef<HTMLInputElement>(null);
  const marginUpgraded =
    letterId !== null &&
    initialDocument.theme.marginStyle === "classic" &&
    !initialDocument.theme.legacyLayout;

  const hasSender = senderAddresses.length > 0;

  const updateDoc = useCallback((updater: (prev: LetterDocument) => LetterDocument) => {
    setDoc(updater);
    setDirty(true);
  }, []);

  // Unsaved-changes guard for hard navigation.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // In-app navigation guard: App Router has no route-change event, so a
  // capture-phase click listener intercepts same-origin link clicks while
  // dirty and offers save-and-leave.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: MouseEvent) => {
      if (bypassGuardRef.current) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (anchor.getAttribute("target") === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveHref(url.pathname + url.search);
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [dirty]);

  const { senderLine, senderCity } = useMemo(() => {
    const chosen =
      senderAddresses.find((a) => a.id === doc.senderAddressId) ??
      senderAddresses.find((a) => a.is_default) ??
      senderAddresses[0];
    return { senderLine: chosen?.sender_line ?? "", senderCity: chosen?.city ?? null };
  }, [doc.senderAddressId, senderAddresses]);

  const recipientLines = useMemo(
    () => ["Muster GmbH", "Frau Erika Mustermann", "Musterstraße 12", "10115 Berlin"],
    [],
  );

  const selectedBlock = doc.blocks.find((b) => b.id === selectedId) ?? null;

  // Pristine document → Schnellstart card (gated on !dirty per jury verdict).
  const pristine =
    !dirty &&
    !persistedId &&
    doc.blocks.every((b) => !("text" in b) || b.text.trim() === "") &&
    !doc.blocks.some((b) => b.type === "image");

  const loadTemplate = (template: Template) => {
    const parsed = safeParseLetterDocument(template.editor_document);
    if (!parsed.success) {
      toast.error(de.letters.templateLoadFailed);
      return;
    }
    updateDoc((prev) =>
      modernizeMarginStyle({ ...parsed.data, senderAddressId: prev.senderAddressId }),
    );
    if (!title.trim()) setTitle(template.name);
    setSelectedId(null);
    setPendingTemplate(null);
    toast.success(de.letters.templateLoaded);
  };

  const requestTemplate = (template: Template) => {
    const hasContent = doc.blocks.some((b) => "text" in b && b.text.trim().length > 0);
    if (hasContent) {
      setPendingTemplate(template);
    } else {
      loadTemplate(template);
    }
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
          | "logoStoragePath"
          | "header"
          | "footer"
          | "showDate"
          | "dateStyle"
          | "dateWithPlace"
          | "senderAddressId"
        >
      >,
    ) => {
      updateDoc((prev) => ({ ...prev, ...patch }));
    },
    [updateDoc],
  );

  /** Inserts after the selected block (or at the end) and selects the new block. */
  const insertBlock = (block: LetterBlock, at?: number) => {
    updateDoc((prev) => {
      const idx = at ?? (() => {
        const selIdx = prev.blocks.findIndex((b) => b.id === selectedId);
        return selIdx >= 0 ? selIdx + 1 : prev.blocks.length;
      })();
      const blocks = [...prev.blocks];
      blocks.splice(Math.min(idx, blocks.length), 0, block);
      return { ...prev, blocks };
    });
    setSelectedId(block.id);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-block-id="${block.id}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      el?.querySelector("textarea")?.focus();
    });
  };

  const addBlock = (type: Exclude<LetterBlock["type"], "image">) => insertBlock(newBlock(type));
  const appendBlock = (type: Exclude<LetterBlock["type"], "image">) =>
    insertBlock(newBlock(type), doc.blocks.length);
  const insertBlockAt = (type: Exclude<LetterBlock["type"], "image">, at: number) =>
    insertBlock(newBlock(type), at);

  /** Appends a page break plus an empty text block, so the user gets a fresh
   *  page to type on (Word-style "insert page"). Focuses the new text block. */
  const addPage = () => {
    const pageBreak = newBlock("pagebreak");
    const text = newBlock("text");
    updateDoc((prev) => ({ ...prev, blocks: [...prev.blocks, pageBreak, text] }));
    setSelectedId(text.id);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-block-id="${text.id}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      el?.querySelector("textarea")?.focus();
    });
  };

  const [pendingImageAt, setPendingImageAt] = useState<number | null>(null);
  const gapImageRef = useRef<HTMLInputElement>(null);
  const requestImageAt = (at: number) => {
    setPendingImageAt(at);
    gapImageRef.current?.click();
  };

  const reorderBlock = (from: number, to: number) =>
    updateDoc((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.blocks.length || to >= prev.blocks.length)
        return prev;
      const blocks = [...prev.blocks];
      const [moved] = blocks.splice(from, 1);
      blocks.splice(to, 0, moved);
      return { ...prev, blocks };
    });

  const addImageBlock = (file: File, at?: number) => {
    startSaving(async () => {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadAssetAction(null, formData);
      if (result.ok && result.data) {
        insertBlock({ ...newBlock("image"), storagePath: result.data.path } as LetterBlock, at);
      } else {
        toast.error(result.ok ? de.common.genericError : result.error);
      }
    });
  };

  const removeBlock = (id: string) => {
    const idx = doc.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const removed = doc.blocks[idx];
    updateDoc((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== id) }));
    if (selectedId === id) setSelectedId(null);
    toast(de.letters.blockRemoved, {
      action: {
        label: de.letters.undo,
        onClick: () =>
          updateDoc((prev) => {
            const blocks = [...prev.blocks];
            blocks.splice(Math.min(idx, blocks.length), 0, removed);
            return { ...prev, blocks };
          }),
      },
    });
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

  const insertAiDraft = (draft: { betreff: string; bloecke: DraftBlock[] }) => {
    if (draft.bloecke.length === 0 && !draft.betreff.trim()) return;
    updateDoc((prev) => {
      const blocks = [...prev.blocks];
      // Subject: fill the first empty subject block, otherwise append one.
      const subjectIdx = blocks.findIndex((b) => b.type === "subject" && !b.text.trim());
      if (subjectIdx >= 0) {
        blocks[subjectIdx] = { ...blocks[subjectIdx], text: draft.betreff } as LetterBlock;
      } else if (draft.betreff.trim()) {
        blocks.push({ ...newBlock("subject"), text: draft.betreff } as LetterBlock);
      }
      // Map each generated module to its editor block, inserting a small gap
      // between consecutive text/heading modules so the letter has clean, airy
      // paragraph spacing (text blocks render with no spacing of their own).
      const AI_GAP_MM = 4;
      const draftBlocks: LetterBlock[] = [];
      for (const b of draft.bloecke) {
        const prev = draftBlocks[draftBlocks.length - 1];
        const isContent = b.kind === "heading" || b.kind === "paragraph";
        const prevIsContent = prev && (prev.type === "heading" || prev.type === "text");
        if (isContent && prevIsContent) {
          draftBlocks.push({ type: "spacer", id: nextId(), heightMm: AI_GAP_MM });
        }
        if (b.kind === "heading") draftBlocks.push({ ...newBlock("heading"), text: b.text } as LetterBlock);
        else if (b.kind === "paragraph") draftBlocks.push({ ...newBlock("text"), text: b.text } as LetterBlock);
        else if (b.kind === "divider") draftBlocks.push(newBlock("divider"));
        else draftBlocks.push({ type: "spacer", id: nextId(), heightMm: AI_GAP_MM });
      }
      // Replace the first empty text block with the modules, else append them.
      const emptyTextIdx = blocks.findIndex((b) => b.type === "text" && !b.text.trim());
      if (emptyTextIdx >= 0 && draftBlocks.length > 0) {
        blocks.splice(emptyTextIdx, 1, ...draftBlocks);
      } else {
        blocks.push(...draftBlocks);
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

  const save = useCallback(
    (onSaved?: (id: string) => void) => {
      if (!title.trim()) {
        toast.error(de.validation.fieldRequired);
        setTitleInvalid(true);
        titleRef.current?.focus();
        return;
      }
      startSaving(async () => {
        if (templateMode) {
          const result = await saveTemplateDocAction(null, {
            id: savedTemplateId,
            name: title,
            document: doc,
          });
          if (result.ok && result.data) {
            setSavedTemplateId(result.data.templateId);
            setDirty(false);
            toast.success(de.letters.templateSaved);
            onSaved?.(result.data.templateId);
          } else {
            toast.error(result.ok ? de.letters.saveFailed : result.error);
          }
          return;
        }
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
    },
    [title, savedId, savedTemplateId, templateMode, doc],
  );

  // Keyboard shortcuts: Cmd/Ctrl+S save, Escape deselect; outside text fields:
  // Alt+arrows move, Cmd/Ctrl+D duplicate, Delete removes non-text blocks.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        // Always suppress the browser save dialog; run save only when the
        // Save button would be enabled and no dialog is open.
        e.preventDefault();
        if (
          !isSaving &&
          (templateMode || hasSender) &&
          !aiOpen &&
          !templateDialogOpen &&
          !pendingTemplate &&
          leaveHref === null
        ) {
          save();
        }
        return;
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        return;
      }
      const target = e.target as HTMLElement | null;
      const inText =
        target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);
      if (inText || !selectedId) return;
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        moveBlock(selectedId, e.key === "ArrowUp" ? -1 : 1);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateBlock(selectedId);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const block = doc.blocks.find((b) => b.id === selectedId);
        if (block && (block.type === "divider" || block.type === "spacer" || block.type === "image")) {
          e.preventDefault();
          removeBlock(selectedId);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const onEditChrome = (kind: "header" | "footer") => {
    setForceOpenHeaderFooter((n) => n + 1);
    requestAnimationFrame(() => {
      const el = document.getElementById(kind === "header" ? "header-text" : "footer-text");
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      (el as HTMLTextAreaElement | null)?.focus();
    });
  };

  const leave = (href: string, viaSave: boolean) => {
    // Bypass the guard only once navigation actually happens — a failed save
    // (empty title, server error) must leave the guard armed.
    if (viaSave) {
      save(() => {
        bypassGuardRef.current = true;
        router.push(href);
      });
    } else {
      bypassGuardRef.current = true;
      router.push(href);
    }
    setLeaveHref(null);
  };

  const estimatedSheets = sheetsFromPages(estimatedPages, false);
  const canvasProps = {
    doc,
    senderLine,
    senderCity,
    recipientLines,
    selectedId,
    showZones,
    showSampleData,
    onSelect: setSelectedId,
    onChangeBlock: updateBlock,
    onMoveBlock: moveBlock,
    onRemoveBlock: removeBlock,
    onDuplicateBlock: duplicateBlock,
    onEstimate: setEstimatedPages,
  };

  return (
    <div className="-mx-4 -mt-4 md:-mx-8 md:-mt-8">
      {/* Sticky top bar */}
      <div className="bg-background/95 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 overflow-x-hidden px-4 md:px-8">
          <Link
            href={templateMode ? "/app/briefe/vorlagen" : "/app/briefe"}
            className="text-muted-foreground hover:text-foreground shrink-0 text-sm transition-colors"
          >
            {templateMode ? de.nav.templates : de.nav.letters}
          </Link>
          <span className="text-muted-foreground/60 text-sm" aria-hidden>
            /
          </span>
          <Label htmlFor="letter-title" className="sr-only">
            {templateMode ? de.letters.templateNameLabel : de.letters.letterName}
          </Label>
          <Input
            ref={titleRef}
            id="letter-title"
            value={title}
            aria-invalid={titleInvalid || undefined}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleInvalid(false);
              setDirty(true);
            }}
            placeholder={templateMode ? de.letters.templateNamePlaceholder : de.letters.letterNamePlaceholder}
            className={cn(
              "font-heading hover:bg-muted/60 focus-visible:bg-background h-9 w-full min-w-0 flex-1 border-transparent bg-transparent px-2 text-lg font-medium shadow-none sm:max-w-[22rem]",
              titleInvalid && "border-destructive ring-destructive/30 ring-2",
            )}
          />
          <span className="text-muted-foreground hidden shrink-0 items-center gap-1.5 text-xs lg:flex">
            {isSaving ? (
              de.common.saving
            ) : dirty ? (
              <>
                <span className="bg-warning size-1.5 rounded-full" aria-hidden />
                {de.letters.unsavedChanges}
              </>
            ) : persistedId ? (
              de.letters.savedStatus
            ) : null}
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {aiEnabled ? (
              <Button
                variant="secondary"
                className="hidden md:inline-flex"
                onClick={() => setAiOpen(true)}
              >
                <Sparkles className="size-4" aria-hidden />
                {de.letters.aiButton}
              </Button>
            ) : null}
            {templateMode ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label={de.letters.moreActions} />
                  }
                >
                  <Ellipsis className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {templates.length > 0 ? (
                    <>
                      <DropdownMenuLabel>{de.letters.useTemplate}</DropdownMenuLabel>
                      {templates.map((t) => (
                        <DropdownMenuItem key={t.id} onClick={() => requestTemplate(t)}>
                          <LayoutTemplate className="size-4" aria-hidden />
                          {t.name}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  <DropdownMenuItem onClick={() => setTemplateDialogOpen(true)}>
                    {de.letters.saveAsTemplate}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {templateMode ? null : (
              <span
                className="hidden md:inline-flex"
                title={!savedId ? de.letters.firstSaveRequired : undefined}
              >
                <Dialog>
                  <DialogTrigger render={<Button variant="ghost" disabled={!savedId} />}>
                    <Eye className="size-4" aria-hidden />
                    <span className="hidden xl:inline">{de.letters.pdfPreviewButton}</span>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                      <DialogTitle>{de.letters.pdfPreviewButton}</DialogTitle>
                    </DialogHeader>
                    {savedId ? <LetterPreview letterId={savedId} version={previewVersion} /> : null}
                    <p className="text-muted-foreground text-xs">{de.letters.estimateDisclaimer}</p>
                  </DialogContent>
                </Dialog>
              </span>
            )}
            <Button
              variant={templateMode ? "default" : "outline"}
              onClick={() => save()}
              disabled={isSaving || (!templateMode && !hasSender)}
            >
              {isSaving ? de.common.saving : de.common.save}
            </Button>
            {templateMode ? null : (
              <Button
                onClick={() => save((id) => {
                  bypassGuardRef.current = true;
                  router.push(`/app/briefe/${id}`);
                })}
                disabled={isSaving || !hasSender}
              >
                {de.common.next}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Notice banners */}
      <div className="mx-auto max-w-[1400px] px-4 md:px-8">
        {!templateMode && !hasSender ? (
          <div className="border-destructive/40 bg-destructive/10 text-destructive mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
            <span>{de.letters.noSenderAddress}</span>
            <Link
              href="/app/einstellungen/absenderadressen"
              className="font-medium underline underline-offset-4"
            >
              {de.letters.createSenderAddress}
            </Link>
          </div>
        ) : null}
        {marginUpgraded && dirty ? (
          <p className="border-warning/40 bg-warning/10 text-foreground mt-4 rounded-md border p-3 text-sm">
            {de.letters.marginUpgradeNotice}
          </p>
        ) : null}
        <p className="bg-muted text-muted-foreground mt-4 rounded-md p-2 text-xs md:hidden">
          {de.letters.mobileReadOnlyHint}
        </p>

        <div className="grid gap-6 py-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* Canvas column */}
          <div className="min-w-0">
            {/* Canvas chrome bar */}
            <div className="mb-2 hidden items-center justify-between gap-2 md:flex">
              <Tooltip>
                <TooltipTrigger render={<Badge variant="outline" className="cursor-default" />}>
                  <FileText className="size-3.5" aria-hidden />
                  ca. {estimatedPages} {estimatedPages === 1 ? "Seite" : de.letters.pageCount} ·{" "}
                  {estimatedSheets} {de.letters.sheetCount}
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  {de.letters.estimateDisclaimer} {de.letters.perRecipientHint}
                </TooltipContent>
              </Tooltip>
              <div className="bg-muted flex items-center gap-0.5 rounded-lg p-0.5">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={de.letters.showZones}
                        aria-pressed={showZones}
                        className={cn(showZones && "bg-background text-primary shadow-sm hover:bg-background")}
                        onClick={() => setShowZones((v) => !v)}
                      />
                    }
                  >
                    <Frame className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{de.letters.showZones}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={de.letters.sampleDataToggle}
                        aria-pressed={showSampleData}
                        className={cn(showSampleData && "bg-background text-primary shadow-sm hover:bg-background")}
                        onClick={() => setShowSampleData((v) => !v)}
                      />
                    }
                  >
                    <Users className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{de.letters.sampleDataToggle}</TooltipContent>
                </Tooltip>
                <span className="bg-border mx-0.5 h-4 w-px" aria-hidden />
                {(["fit", "full"] as const).map((z) => (
                  <Button
                    key={z}
                    variant="ghost"
                    size="sm"
                    aria-pressed={zoom === z}
                    className={cn(
                      "h-6.5 px-2 text-xs",
                      zoom === z && "bg-background text-foreground shadow-sm hover:bg-background",
                    )}
                    onClick={() => setZoom(z)}
                  >
                    {z === "fit" ? de.letters.zoomFit : de.letters.zoom100}
                  </Button>
                ))}
              </div>
            </div>

            {/* Placeholder strip (Serienbrief) */}
            <div className="bg-background/95 sticky top-14 z-20 mb-3 hidden flex-wrap items-center gap-1.5 py-2 backdrop-blur md:flex">
              <span className="text-muted-foreground mr-1 text-xs font-medium">
                {de.letters.placeholdersLabel}:
              </span>
              {PLACEHOLDER_KEYS.map((key) => (
                <Button
                  key={key}
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="h-6 rounded-full px-2.5"
                  onClick={() => insertPlaceholder(key)}
                >
                  <span aria-hidden className="text-primary/60">
                    {"{}"}
                  </span>
                  {PLACEHOLDER_LABELS[key]}
                </Button>
              ))}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={de.letters.placeholdersHint}
                      className="text-muted-foreground ml-1"
                    />
                  }
                >
                  <Info className="size-3.5" aria-hidden />
                </TooltipTrigger>
                <TooltipContent className="max-w-72">
                  {de.letters.placeholdersHint} {de.letters.perRecipientHint}
                </TooltipContent>
              </Tooltip>
              {unknownTokens.length > 0 ? (
                <Tooltip>
                  <TooltipTrigger
                    render={<Badge variant="outline" className="border-warning text-warning ml-auto cursor-default" />}
                  >
                    {de.letters.unknownPlaceholderBadge}
                  </TooltipTrigger>
                  <TooltipContent className="max-w-72">
                    {de.letters.unknownPlaceholderWarning}{" "}
                    {unknownTokens.map((t) => `{{${t}}}`).join(", ")}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>

            {/* Workspace well */}
            <div className="bg-workspace overflow-hidden rounded-xl p-4 md:p-10">
              {pristine ? (
                <div className="bg-background mx-auto mb-6 hidden max-w-xl rounded-lg border p-4 md:block">
                  <p className="font-heading mb-3 text-sm font-medium">{de.letters.starterTitle}</p>
                  <div className="flex flex-wrap gap-2">
                    {aiEnabled ? (
                      <Button variant="outline" size="sm" onClick={() => setAiOpen(true)}>
                        <Sparkles className="size-3.5" aria-hidden />
                        {de.letters.startAi}
                      </Button>
                    ) : null}
                    {templates.length > 0 ? (
                      <Button variant="outline" size="sm" onClick={() => requestTemplate(templates[0])}>
                        <LayoutTemplate className="size-3.5" aria-hidden />
                        {de.letters.useTemplate}
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const first = doc.blocks.find((b) => b.type === "subject") ?? doc.blocks[0];
                        if (first) {
                          setSelectedId(first.id);
                          (
                            document.querySelector(
                              `[data-block-id="${first.id}"] textarea`,
                            ) as HTMLTextAreaElement | null
                          )?.focus();
                        }
                      }}
                    >
                      <PenLine className="size-3.5" aria-hidden />
                      {de.letters.startBlank}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="hidden md:block">
                <LetterCanvas
                  {...canvasProps}
                  readOnly={false}
                  zoom={zoom}
                  onFocusText={(blockId, el) =>
                    (activeTextRef.current = { kind: "block", blockId, el })
                  }
                  onEditChrome={onEditChrome}
                  onReorderBlock={reorderBlock}
                  onInsertBlockAt={insertBlockAt}
                  onInsertImageAt={requestImageAt}
                />
              </div>
              <input
                ref={gapImageRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && pendingImageAt !== null) addImageBlock(file, pendingImageAt);
                  setPendingImageAt(null);
                  e.target.value = "";
                }}
              />
              <div className="md:hidden">
                <LetterCanvas
                  {...canvasProps}
                  readOnly
                  showZones={false}
                  zoom="fit"
                  onFocusText={() => undefined}
                />
              </div>

              <div className="mt-4 hidden items-center justify-center gap-2 md:flex">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="outline" size="sm" className="bg-background" />}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    {de.letters.addBlock}
                  </DropdownMenuTrigger>
                  <BlockInsertMenuContent
                    align="center"
                    onInsert={appendBlock}
                    onInsertImage={() => wellImageRef.current?.click()}
                  />
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-background"
                  onClick={addPage}
                >
                  <FileStack className="size-3.5" aria-hidden />
                  {de.letters.addPage}
                </Button>
              </div>
              <input
                ref={wellImageRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) addImageBlock(file, doc.blocks.length);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          {/* Inspector column */}
          <div className="min-w-0 xl:sticky xl:top-[4.5rem] xl:max-h-[calc(100vh-5.5rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
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
              onAddBlock={addBlock}
              onAddImage={(file) => addImageBlock(file)}
              onDuplicateBlock={duplicateBlock}
              onRemoveBlock={removeBlock}
              forceOpenHeaderFooter={forceOpenHeaderFooter}
            />
          </div>
        </div>
      </div>

      {/* AI draft dialog (controlled — opened from top bar or starter card) */}
      {aiEnabled ? (
        <AiDraftDialog
          mock={aiMock}
          onDraft={insertAiDraft}
          open={aiOpen}
          onOpenChange={setAiOpen}
          hideTrigger
        />
      ) : null}

      {/* Save-as-template dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
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

      {/* Template-load confirmation (replaces window.confirm) */}
      <Dialog open={pendingTemplate !== null} onOpenChange={(o) => !o && setPendingTemplate(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{de.letters.useTemplate}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">{de.letters.templateLoadConfirm}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingTemplate(null)}>
              {de.common.cancel}
            </Button>
            <Button onClick={() => pendingTemplate && loadTemplate(pendingTemplate)}>
              {de.letters.templateLoadConfirmAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave-while-dirty dialog (in-app navigation guard) */}
      <Dialog open={leaveHref !== null} onOpenChange={(o) => !o && setLeaveHref(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{de.letters.unsavedChanges}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">{de.letters.leaveConfirmBody}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLeaveHref(null)}>
              {de.common.cancel}
            </Button>
            <Button
              variant="outline"
              onClick={() => leaveHref && leave(leaveHref, false)}
            >
              {de.letters.leaveWithoutSaving}
            </Button>
            <Button
              disabled={isSaving || !hasSender}
              onClick={() => leaveHref && leave(leaveHref, true)}
            >
              {de.letters.saveAndLeave}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
