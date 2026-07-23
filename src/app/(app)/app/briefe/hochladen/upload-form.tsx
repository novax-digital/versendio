"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import {
  createLetterUploadUrlAction,
  uploadLetterAction,
  type UploadLetterResult,
} from "../actions";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { ValidationReport } from "@/components/letters/validation-report";
import { createClient } from "@/lib/supabase/client";
import { LIMITS } from "@/lib/shared/schablone";
import { de } from "@/lib/i18n/de";

/**
 * Two-step upload: a Server Action mints a signed storage URL, the browser
 * PUTs the PDF directly to Supabase (Server Actions buffer the whole body
 * before auth runs and Vercel caps request bodies at ~4.5 MB — both wrong for
 * 20 MB PDFs), then a second action validates and persists the letter.
 */
export function UploadForm() {
  const router = useRouter();
  const [result, setResult] = useState<UploadLetterResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-check type and size before any network traffic so oversized or
  // non-PDF picks fail instantly with our message.
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setFileName(null);
      setFileError(null);
      return;
    }
    if (file.type !== "application/pdf") {
      e.target.value = "";
      setFileName(null);
      setFileError(de.letters.notPdf);
      return;
    }
    if (file.size > LIMITS.maxFileSizeBytes) {
      e.target.value = "";
      setFileName(null);
      setFileError(de.letters.tooLarge);
      return;
    }
    setFileError(null);
    setFileName(file.name);
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title = String(new FormData(e.currentTarget).get("title") ?? "");
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setFileError(de.letters.noFile);
      return;
    }
    startTransition(async () => {
      const urlResult = await createLetterUploadUrlAction();
      if (!urlResult.ok) {
        setResult({ ok: false, error: urlResult.error });
        return;
      }

      // Direct browser → storage transfer via the signed token (RLS-free,
      // path pinned server-side to the caller's own prefix).
      const supabase = createClient();
      const { error: transferError } = await supabase.storage
        .from("letters")
        .uploadToSignedUrl(urlResult.path, urlResult.token, file, {
          contentType: "application/pdf",
        });
      if (transferError) {
        setResult({ ok: false, error: de.letters.uploadTransferFailed });
        return;
      }

      const fd = new FormData();
      fd.set("title", title);
      fd.set("path", urlResult.path);
      const finalized = await uploadLetterAction(null, fd);
      setResult(finalized);
      if (finalized.ok) {
        toast.success(de.letters.uploaded);
        router.push(`/app/briefe/${finalized.letterId}`);
      }
    });
  };

  const validation = result?.ok ? result.validation : result?.validation;
  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <FormField
        label={de.letters.letterName}
        name="title"
        placeholder={de.letters.letterNamePlaceholder}
        required
        error={fieldErrors?.title}
      />

      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="border-input hover:border-primary hover:bg-muted/50 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors"
        >
          <Upload className="text-muted-foreground size-6" aria-hidden />
          <span className="text-sm font-medium">{fileName ?? de.letters.uploadDropzone}</span>
          <span className="text-muted-foreground text-xs">{de.letters.uploadHint}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept="application/pdf"
          className="sr-only"
          onChange={onFileChange}
        />
        {fileError ? (
          <p role="alert" className="text-destructive text-sm">
            {fileError}
          </p>
        ) : null}
      </div>

      {result && !result.ok && result.error ? (
        <p role="alert" className="text-destructive text-sm">
          {result.error}
        </p>
      ) : null}

      {validation ? (
        <div className="rounded-md border p-4">
          <ValidationReport validation={validation} />
        </div>
      ) : null}

      <Button type="submit" disabled={pending || !fileName} className="w-full">
        {pending ? de.letters.previewLoading : de.letters.uploadTitle}
      </Button>
    </form>
  );
}
