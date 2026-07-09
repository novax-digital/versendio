"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Copy, Download, Upload } from "lucide-react";
import Papa from "papaparse";
import {
  startImportAction,
  commitImportAction,
  type StartImportResult,
  type CommitImportResult,
} from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CONTACT_FIELDS, FIELD_LABELS_DE, type ContactField } from "@/lib/shared/import/mapping";
import { de } from "@/lib/i18n/de";
import { ButtonLink } from "@/components/ui-ext/button-link";

type Analyzed = Extract<StartImportResult, { ok: true }>;
type Committed = Extract<CommitImportResult, { ok: true }>;

export function ImportWizard() {
  const [analyzed, setAnalyzed] = useState<Analyzed | null>(null);
  const [result, setResult] = useState<Committed | null>(null);

  if (result) return <ResultStep result={result} />;
  if (analyzed)
    return (
      <MappingStep analyzed={analyzed} onCommitted={setResult} onBack={() => setAnalyzed(null)} />
    );
  return <UploadStep onAnalyzed={setAnalyzed} />;
}

function UploadStep({ onAnalyzed }: { onAnalyzed: (a: Analyzed) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const handleFile = (file: File | null) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const result = await startImportAction(null, fd);
      if (result.ok) onAnalyzed(result);
      else toast.error(result.error);
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className="border-input hover:border-primary hover:bg-muted/50 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center transition-colors disabled:opacity-60"
      >
        <Upload className="text-muted-foreground size-6" aria-hidden />
        <span className="text-sm font-medium">
          {pending ? de.common.loading : de.contacts.importDropzone}
        </span>
        <span className="text-muted-foreground text-xs">{de.contacts.importHint}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

function MappingStep({
  analyzed,
  onCommitted,
  onBack,
}: {
  analyzed: Analyzed;
  onCommitted: (r: Committed) => void;
  onBack: () => void;
}) {
  const [mapping, setMapping] = useState<Record<number, ContactField | null>>(analyzed.suggested);
  const [createList, setCreateList] = useState(true);
  const [listName, setListName] = useState("");
  const [pending, startTransition] = useTransition();

  const assign = (index: number, field: ContactField | "ignore") => {
    setMapping((prev) => {
      const next: Record<number, ContactField | null> = { ...prev };
      if (field !== "ignore") {
        // A field may be assigned to only one column.
        for (const k of Object.keys(next)) {
          if (next[Number(k)] === field) next[Number(k)] = null;
        }
      }
      next[index] = field === "ignore" ? null : field;
      return next;
    });
  };

  const commit = () => {
    startTransition(async () => {
      const result = await commitImportAction(null, {
        importPath: analyzed.importPath,
        fileName: analyzed.fileName,
        mapping: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v])),
        listName: createList ? listName : "",
      });
      if (result.ok) onCommitted(result);
      else toast.error(result.error);
    });
  };

  const mappedFields = new Set(Object.values(mapping).filter(Boolean));
  const mappingComplete =
    mappedFields.has("street") && mappedFields.has("zip") && mappedFields.has("city");
  const listNameMissing = createList && !listName.trim();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.contacts.mappingTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">{de.contacts.mappingHint}</p>
          <p className="text-muted-foreground text-xs">{de.contacts.rowCount(analyzed.totalRows)}</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{de.contacts.mappingColumn}</TableHead>
                  <TableHead>{de.contacts.mappingField}</TableHead>
                  <TableHead>{de.contacts.mappingPreview}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analyzed.headers.map((header, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{header || de.common.column(index + 1)}</TableCell>
                    <TableCell>
                      <Select
                        value={mapping[index] ?? "ignore"}
                        onValueChange={(v) => assign(index, v as ContactField | "ignore")}
                      >
                        <SelectTrigger className="w-52">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ignore">{de.contacts.mappingIgnore}</SelectItem>
                          {CONTACT_FIELDS.map((field) => (
                            <SelectItem key={field} value={field}>
                              {FIELD_LABELS_DE[field]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-48 truncate text-xs">
                      {analyzed.previewRows.map((r) => r[index]).filter(Boolean).slice(0, 3).join(" · ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!mappingComplete ? (
            <p className="flex items-center gap-2 text-sm text-amber-600">
              <AlertCircle className="size-4" aria-hidden />
              {de.contacts.importMappingIncomplete}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="create-list"
              checked={createList}
              onCheckedChange={(v) => setCreateList(v === true)}
            />
            <Label htmlFor="create-list" className="font-normal">
              {de.contacts.createListLabel}
            </Label>
          </div>
          {createList ? (
            <div className="space-y-1.5">
              <Label htmlFor="list-name">{de.contacts.listNameLabel}</Label>
              <Input
                id="list-name"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder={de.contacts.listNamePlaceholder}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={pending}>
          {de.common.back}
        </Button>
        <Button onClick={commit} disabled={pending || !mappingComplete || listNameMissing}>
          {pending ? de.contacts.importing : de.contacts.startImport}
        </Button>
      </div>
    </div>
  );
}

function ResultStep({ result }: { result: Committed }) {
  // Guard against CSV formula injection (CWE-1236): cells starting with
  // = + - @ or tab/CR would execute as formulas when opened in Excel.
  const sanitizeCell = (value: string | number): string | number => {
    if (typeof value !== "string") return value;
    return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  };

  const downloadErrors = () => {
    const csv = Papa.unparse({
      fields: [de.contacts.errorRowLabel, "Fehler", ...result.headers.map(String)],
      data: result.errorRows.map((row) => [
        row.rowNumber,
        sanitizeCell(row.errors.join("; ")),
        ...row.raw.map(sanitizeCell),
      ]),
    });
    // BOM so Excel opens the file with correct umlauts.
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-fehler.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{de.contacts.resultTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
            {de.contacts.resultImported(result.imported)}
          </li>
          <li className="flex items-center gap-2">
            <Copy className="size-4 text-amber-600" aria-hidden />
            {de.contacts.resultDuplicates(result.duplicates)}
          </li>
          <li className="flex items-center gap-2">
            <AlertCircle
              className={`size-4 ${result.failed > 0 ? "text-destructive" : "text-muted-foreground"}`}
              aria-hidden
            />
            {de.contacts.resultFailed(result.failed)}
          </li>
        </ul>
        {result.errorRows.length > 0 ? (
          <Button variant="outline" onClick={downloadErrors}>
            <Download className="size-4" aria-hidden />
            {de.contacts.downloadErrors}
          </Button>
        ) : null}
        <div className="flex gap-2 pt-2">
          <ButtonLink href="/app/kontakte">{de.contacts.toContacts}</ButtonLink>
          {result.listId ? (
            <ButtonLink href={`/app/leadlisten/${result.listId}`} variant="outline">
              {de.contacts.toList}
            </ButtonLink>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
