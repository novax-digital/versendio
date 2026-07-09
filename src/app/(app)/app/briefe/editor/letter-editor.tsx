"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2, Type, Heading, SeparatorHorizontal } from "lucide-react";
import { saveEditorLetterAction, saveTemplateAction } from "../actions";
import { letterDocumentSchema } from "@/lib/shared/letter-document";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LetterPreview } from "@/components/letters/letter-preview";
import { PLACEHOLDER_KEYS, PLACEHOLDER_LABELS, unknownPlaceholders } from "@/lib/shared/placeholders";
import type { LetterBlock, LetterDocument } from "@/lib/shared/letter-document";
import { de } from "@/lib/i18n/de";

type SenderAddress = { id: string; label: string; sender_line: string; is_default: boolean };
type Template = { id: string; name: string; editor_document: unknown };

let blockCounter = 0;
const nextId = () => `b${Date.now()}-${blockCounter++}`;

export function LetterEditor({
  letterId,
  initialTitle,
  initialDocument,
  senderAddresses,
  templates,
}: {
  letterId: string | null;
  initialTitle: string;
  initialDocument: LetterDocument;
  senderAddresses: SenderAddress[];
  templates: Template[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [doc, setDoc] = useState<LetterDocument>(initialDocument);
  const [savedId, setSavedId] = useState<string | null>(letterId);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [isSaving, startSaving] = useTransition();
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const activeTextRef = useRef<{
    blockId: string;
    el: HTMLTextAreaElement | HTMLInputElement;
  } | null>(null);

  const hasSender = senderAddresses.length > 0;

  const loadTemplate = (template: Template) => {
    const parsed = letterDocumentSchema.safeParse(template.editor_document);
    if (!parsed.success) {
      toast.error(de.letters.saveFailed);
      return;
    }
    // Keep the currently selected sender address.
    setDoc({ ...parsed.data, senderAddressId: doc.senderAddressId });
    if (!title.trim()) setTitle(template.name);
    toast.success(de.letters.saved);
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

  const updateBlock = useCallback((id: string, patch: Partial<LetterBlock>) => {
    setDoc((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as LetterBlock) : b)),
    }));
  }, []);

  const addBlock = (type: LetterBlock["type"]) => {
    const block: LetterBlock =
      type === "subject"
        ? { type: "subject", id: nextId(), text: "" }
        : type === "text"
          ? { type: "text", id: nextId(), text: "" }
          : { type: "spacer", id: nextId(), heightMm: 8 };
    setDoc((prev) => ({ ...prev, blocks: [...prev.blocks, block] }));
  };

  const removeBlock = (id: string) =>
    setDoc((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== id) }));

  const moveBlock = (id: string, dir: -1 | 1) =>
    setDoc((prev) => {
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
    const block = doc.blocks.find((b) => b.id === active.blockId);
    if (!block || (block.type !== "text" && block.type !== "subject")) return;
    const nextText = block.text.slice(0, start) + token + block.text.slice(end);
    updateBlock(active.blockId, { text: nextText });
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

  const unknownTokens = useMemo(() => {
    const found = new Set<string>();
    for (const b of doc.blocks) {
      if (b.type === "text" || b.type === "subject") {
        for (const t of unknownPlaceholders(b.text)) found.add(t);
      }
    }
    return [...found];
  }, [doc.blocks]);

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
        toast.success(de.letters.saved);
        onSaved?.(result.data.letterId);
      } else {
        toast.error(result.ok ? de.letters.saveFailed : result.error);
      }
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{de.letters.editorTitle}</h1>
          <p className="text-muted-foreground text-sm">{de.letters.editorSubtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
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

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="letter-title">{de.letters.letterName}</Label>
            <Input
              id="letter-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={de.letters.letterNamePlaceholder}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{de.letters.senderAddressSelect}</Label>
            <Select
              value={doc.senderAddressId ?? undefined}
              onValueChange={(v) => setDoc((prev) => ({ ...prev, senderAddressId: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder={de.letters.senderAddressSelect} />
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

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{de.letters.editorTitle}</CardTitle>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                  <Plus className="size-4" aria-hidden />
                  {de.letters.addBlock}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => addBlock("subject")}>
                    <Heading className="size-4" aria-hidden />
                    {de.letters.blockSubject}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => addBlock("text")}>
                    <Type className="size-4" aria-hidden />
                    {de.letters.blockText}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => addBlock("spacer")}>
                    <SeparatorHorizontal className="size-4" aria-hidden />
                    {de.letters.blockSpacer}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent className="space-y-3">
              {doc.blocks.map((block, i) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  isFirst={i === 0}
                  isLast={i === doc.blocks.length - 1}
                  onChange={(patch) => updateBlock(block.id, patch)}
                  onRemove={() => removeBlock(block.id)}
                  onMove={(dir) => moveBlock(block.id, dir)}
                  onFocusText={(el) => (activeTextRef.current = { blockId: block.id, el })}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{de.letters.placeholders}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-muted-foreground text-xs">{de.letters.placeholdersHint}</p>
              <div className="flex flex-wrap gap-2">
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
                <p className="text-amber-600 text-xs">
                  {de.letters.unknownPlaceholderWarning}{" "}
                  {unknownTokens.map((t) => `{{${t}}}`).join(", ")}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          {savedId ? (
            <LetterPreview letterId={savedId} version={previewVersion} />
          ) : (
            <div className="bg-muted text-muted-foreground flex aspect-[210/297] max-w-md items-center justify-center rounded-md border p-6 text-center text-sm">
              {de.letters.previewLoading} — {de.common.save}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BlockEditor({
  block,
  isFirst,
  isLast,
  onChange,
  onRemove,
  onMove,
  onFocusText,
}: {
  block: LetterBlock;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<LetterBlock>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onFocusText: (el: HTMLTextAreaElement | HTMLInputElement) => void;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium uppercase">
          {block.type === "subject"
            ? de.letters.blockSubject
            : block.type === "text"
              ? de.letters.blockText
              : block.type === "spacer"
                ? de.letters.blockSpacer
                : de.letters.blockImage}
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => onMove(-1)} disabled={isFirst} aria-label={de.letters.moveUp}>
            <ArrowUp className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onMove(1)} disabled={isLast} aria-label={de.letters.moveDown}>
            <ArrowDown className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={onRemove} aria-label={de.letters.removeBlock}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {block.type === "subject" ? (
        <Input
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          onFocus={(e) => onFocusText(e.currentTarget)}
          placeholder={de.letters.blockSubject}
        />
      ) : null}
      {block.type === "text" ? (
        <Textarea
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          onFocus={(e) => onFocusText(e.currentTarget)}
          rows={5}
          placeholder={de.letters.blockText}
        />
      ) : null}
      {block.type === "spacer" ? (
        <div className="flex items-center gap-2">
          <Label className="text-xs">{de.letters.blockSpacer} (mm)</Label>
          <Input
            type="number"
            min={1}
            max={120}
            value={block.heightMm}
            onChange={(e) => onChange({ heightMm: Number(e.target.value) || 1 })}
            className="w-24"
          />
        </div>
      ) : null}
    </div>
  );
}
