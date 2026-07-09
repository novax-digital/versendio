"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { uploadLetterAction } from "../actions";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { ValidationReport } from "@/components/letters/validation-report";
import { de } from "@/lib/i18n/de";

export function UploadForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(uploadLetterAction, null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(de.letters.uploaded);
      router.push(`/app/briefe/${state.letterId}`);
    }
  }, [state, router]);

  const validation = state?.ok ? state.validation : state?.validation;
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-5" noValidate>
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
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
      </div>

      {state && !state.ok && state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
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
