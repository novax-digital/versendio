"use client";

import { useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { de } from "@/lib/i18n/de";

type Defaults = {
  company: string;
  representative: string;
  street: string;
  zip: string;
  city: string;
};

export function AvvForm({ defaults }: { defaults: Defaults }) {
  const [pending, setPending] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const signature = sigRef.current?.toDataUrl() ?? null;
    if (!signature) {
      toast.error(de.avv.signatureMissing);
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/app/einstellungen/avv/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: form.get("company"),
          representative: form.get("representative"),
          street: form.get("street"),
          zip: form.get("zip"),
          city: form.get("city"),
          signature,
        }),
      });
      if (!res.ok) {
        toast.error(de.avv.generateError);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = de.avv.downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(de.avv.generated);
    } catch {
      toast.error(de.avv.generateError);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-muted-foreground text-sm">{de.avv.fillText}</p>

      <div className="space-y-1.5">
        <Label htmlFor="avv-company">{de.avv.company}</Label>
        <Input
          id="avv-company"
          name="company"
          defaultValue={defaults.company}
          required
          minLength={2}
          maxLength={80}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="avv-representative">{de.avv.representative}</Label>
        <Input
          id="avv-representative"
          name="representative"
          defaultValue={defaults.representative}
          required
          minLength={2}
          maxLength={80}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="avv-street">{de.avv.street}</Label>
        <Input
          id="avv-street"
          name="street"
          defaultValue={defaults.street}
          required
          minLength={3}
          maxLength={80}
        />
      </div>
      <div className="grid grid-cols-[minmax(5rem,1fr)_2fr] gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="avv-zip">{de.avv.zip}</Label>
          <Input id="avv-zip" name="zip" defaultValue={defaults.zip} required minLength={3} maxLength={10} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="avv-city">{de.avv.city}</Label>
          <Input id="avv-city" name="city" defaultValue={defaults.city} required minLength={2} maxLength={60} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{de.avv.signatureLabel}</Label>
        <SignaturePad ref={sigRef} />
        <p className="text-muted-foreground text-xs">{de.avv.signatureHint}</p>
      </div>

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? de.avv.generating : de.avv.generateButton}
      </Button>
    </form>
  );
}

type SignaturePadHandle = {
  /** PNG data URL of the drawing, or null while the pad is empty. */
  toDataUrl: () => string | null;
};

/**
 * Minimal pointer-based signature pad. Drawn at devicePixelRatio for crisp
 * export; transparent background so the PDF's signature line stays visible
 * underneath the embedded image.
 */
function SignaturePad({ ref }: { ref: React.Ref<SignaturePadHandle> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  const ctx = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (canvas.width === 0) {
      const scale = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * scale;
      canvas.height = canvas.offsetHeight * scale;
      const c = canvas.getContext("2d");
      c?.scale(scale, scale);
      return c;
    }
    return canvas.getContext("2d");
  };

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const c = ctx();
    if (!c) return;
    const { x, y } = point(e);
    c.beginPath();
    c.lineWidth = 2;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = "#111";
    c.moveTo(x, y);
    // A dot for taps, so even the shortest stroke leaves ink.
    c.lineTo(x + 0.1, y + 0.1);
    c.stroke();
    setHasStrokes(true);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const c = ctx();
    if (!c) return;
    const { x, y } = point(e);
    c.lineTo(x, y);
    c.stroke();
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const c = canvas?.getContext("2d");
    if (canvas && c) c.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
  };

  useImperativeHandle(ref, () => ({
    toDataUrl: () =>
      hasStrokes ? (canvasRef.current?.toDataURL("image/png") ?? null) : null,
  }));

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        className="bg-background h-40 w-full touch-none rounded-md border"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        aria-label={de.avv.signatureLabel}
      />
      <Button type="button" variant="outline" size="sm" onClick={clear} disabled={!hasStrokes}>
        <Eraser className="size-4" aria-hidden />
        {de.avv.signatureClear}
      </Button>
    </div>
  );
}
