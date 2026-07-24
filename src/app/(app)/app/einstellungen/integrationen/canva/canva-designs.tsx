"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Import } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { de } from "@/lib/i18n/de";
import { disconnectCanvaAction, importCanvaDesignAction } from "../actions";

const t = de.integrations;

export type CanvaDesignView = {
  id: string;
  title: string;
  updatedAt: number | null;
  pageCount: number | null;
  thumbnailUrl: string | null;
};

/** One-shot toasts for the OAuth redirect query params. */
export function CanvaStatusToast({
  connected,
  errorText,
}: {
  connected: boolean;
  errorText: string | null;
}) {
  const router = useRouter();
  useEffect(() => {
    if (connected) toast.success(t.canvaJustConnected);
    if (errorText) toast.error(errorText);
    if (connected || errorText) {
      // Strip the params so a reload can't re-toast.
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [connected, errorText, router]);
  return null;
}

export function CanvaDesignGrid({
  designs,
  loadFailed,
}: {
  designs: CanvaDesignView[];
  loadFailed: boolean;
}) {
  const router = useRouter();
  const [importingId, setImportingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (loadFailed) {
    return <p className="text-muted-foreground text-sm">{t.canvaDesignsLoadFailed}</p>;
  }
  if (designs.length === 0) {
    return <p className="text-muted-foreground text-sm">{t.canvaDesignsEmpty}</p>;
  }

  const importDesign = (design: CanvaDesignView) => {
    setImportingId(design.id);
    const fd = new FormData();
    fd.set("designId", design.id);
    fd.set("title", design.title);
    startTransition(async () => {
      const result = await importCanvaDesignAction(null, fd);
      setImportingId(null);
      if (result.ok && result.data) {
        toast.success(t.canvaImported);
        router.push(`/app/briefe/${result.data.letterId}`);
      } else {
        toast.error((!result.ok && result.error) || de.common.genericError);
      }
    });
  };

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {designs.map((design) => (
        <li key={design.id} className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="bg-muted flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md">
            {design.thumbnailUrl ? (
              // Canva thumbnail URLs are short-lived signed URLs on
              // *.canva.com — next/image would require remote-pattern config
              // and re-proxying; a plain img is the right tool here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={design.thumbnailUrl}
                alt={design.title}
                className="h-full w-full object-contain"
                loading="lazy"
              />
            ) : (
              <FileText className="text-muted-foreground size-8" aria-hidden />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={design.title}>
              {design.title}
            </p>
            <p className="text-muted-foreground text-xs">
              {design.pageCount != null ? t.canvaPages(design.pageCount) : ""}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-auto"
            disabled={importingId !== null}
            onClick={() => importDesign(design)}
          >
            <Import className="size-4" aria-hidden />
            {importingId === design.id ? t.canvaImporting : t.canvaImport}
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function CanvaDisconnectButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const disconnect = () => {
    startTransition(async () => {
      const result = await disconnectCanvaAction();
      if (result.ok) {
        toast.success(t.canvaDisconnected);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" className="text-destructive" />}>
        {t.canvaDisconnect}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.canvaDisconnect}</AlertDialogTitle>
          <AlertDialogDescription>{t.canvaDisconnectConfirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={disconnect} disabled={pending}>
            {t.canvaDisconnect}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
