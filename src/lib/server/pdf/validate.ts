import "server-only";
import { PDFDocument } from "pdf-lib";
import { A4, LIMITS } from "@/lib/shared/schablone";
import { sheetsFromPages } from "@/lib/shared/sheets";
import type { PdfValidation, ValidationRule, ZoneResult } from "@/lib/shared/validation-result";
import { analyzeAddressZones } from "./analyze-zones";
import { A4_EXACT_TOLERANCE_PT } from "./normalize";

/**
 * The single validation path for both uploaded and generated PDFs (ADR-0006).
 * No PDF reaches the provider without passing through here.
 *
 * `source: "editor"` marks a PDF our own renderer produced: it places the
 * sender/recipient into the fixed Schablone V3 zones and enforces margins/DVF
 * by construction (A-010), and it embeds subset fonts with no transparency. The
 * upload-only advisories — the PDF/A "conversion may change the look" caveat and
 * the heuristic address-zone text analysis — are therefore meaningless for it
 * and would only mislead, so they are replaced by a positive confirmation. The
 * hard checks (A4 box, size, page/sheet limits, encryption) still run for both.
 */
export async function validateLetterPdf(
  bytes: Uint8Array,
  opts: { source?: "upload" | "editor"; a4Normalized?: boolean } = {},
): Promise<PdfValidation> {
  const isEditor = opts.source === "editor";
  const rules: ValidationRule[] = [];
  const fileSizeBytes = bytes.byteLength;

  if (fileSizeBytes > LIMITS.maxFileSizeBytes) {
    rules.push({
      id: "file_size",
      severity: "error",
      message: `Die Datei ist zu groß (max. ${Math.round(LIMITS.maxFileSizeBytes / 1024 / 1024)} MB).`,
    });
  }

  let doc: PDFDocument;
  try {
    // ignoreEncryption lets us detect encrypted files and show the dedicated
    // message instead of a generic parse error.
    doc = await PDFDocument.load(bytes, { throwOnInvalidObject: false, ignoreEncryption: true });
  } catch {
    rules.push({
      id: "parse",
      severity: "error",
      message: "Die Datei konnte nicht als PDF gelesen werden. Ist sie beschädigt oder verschlüsselt?",
    });
    return {
      pageCount: null,
      sheetCountSimplex: null,
      fileSizeBytes,
      isPdfA: false,
      addressZoneResult: "fail",
      needsCoverLetter: true,
      rules,
    };
  }

  if (doc.isEncrypted) {
    rules.push({
      id: "encrypted",
      severity: "error",
      message: "Verschlüsselte PDFs können nicht versendet werden. Bitte entfernen Sie den Passwortschutz.",
    });
  }

  // Our downloadable sample carries a keyword marker: it deliberately draws
  // the blocked zones (vector ink the text-based zone analysis cannot see),
  // so the carrier would reject it — fail fast with a clear message instead.
  try {
    if (doc.getKeywords()?.includes("versendio-muster")) {
      rules.push({
        id: "muster_sample",
        severity: "error",
        message: "Das Muster-PDF dient nur zur Ansicht und kann nicht versendet werden.",
      });
    }
  } catch {
    // Metadata parsing is best-effort; a corrupt info dict must not block validation.
  }

  const pageCount = doc.getPageCount();
  const sheetCountSimplex = sheetsFromPages(pageCount, false);

  if (pageCount === 0) {
    rules.push({ id: "empty", severity: "error", message: "Das Dokument enthält keine Seiten." });
  }
  // Sheet limit is 94; duplex fits two pages per sheet, so up to 188 pages can
  // still be sent (duplex only). Beyond that it is impossible in any mode.
  if (pageCount > LIMITS.maxSheets * 2) {
    rules.push({
      id: "page_count",
      severity: "error",
      message: `Zu viele Seiten (${pageCount}). Es sind maximal ${LIMITS.maxSheets} Blatt erlaubt (${LIMITS.maxSheets * 2} Seiten bei beidseitigem Druck).`,
    });
  } else if (pageCount > LIMITS.maxSheets) {
    rules.push({
      id: "page_count_duplex_only",
      severity: "warning",
      message: `${pageCount} Seiten überschreiten ${LIMITS.maxSheets} Blatt bei einseitigem Druck – der Versand ist nur beidseitig möglich.`,
    });
  }

  // A4 portrait, exact box. Check every page. Small deviations were already
  // rescaled by normalizePdfToA4 before this runs — a remaining mismatch is a
  // genuine format problem a cover page cannot fix (the API checks every page).
  let a4Ok = true;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    if (
      Math.abs(width - A4.widthPt) > A4_EXACT_TOLERANCE_PT ||
      Math.abs(height - A4.heightPt) > A4_EXACT_TOLERANCE_PT
    ) {
      a4Ok = false;
      break;
    }
  }
  if (!a4Ok) {
    rules.push({
      id: "a4",
      severity: "error",
      message:
        "Alle Seiten müssen DIN A4 Hochformat sein (210 × 297 mm). Die Abweichung ist zu groß für eine automatische Korrektur – bitte exportieren Sie Ihr Dokument im Format DIN A4 und laden Sie es erneut hoch.",
    });
  } else if (opts.a4Normalized) {
    rules.push({
      id: "a4_adjusted",
      severity: "ok",
      message:
        "Das Seitenformat wich geringfügig von DIN A4 ab und wurde automatisch auf 210 × 297 mm angepasst.",
    });
  }

  // PDF/A heuristic via XMP metadata marker. Editor PDFs embed subset fonts and
  // use no transparency, so their send-time conversion is lossless — the caveat
  // only applies to arbitrary uploads. A normalized (rescaled) document no
  // longer conforms even if its XMP claim survived the re-save, so the
  // conversion advisory must fire again.
  const isPdfA = detectPdfA(bytes) && !opts.a4Normalized;
  if (!isPdfA && !isEditor) {
    rules.push({
      id: "pdfa",
      severity: "warning",
      message:
        "Das PDF ist kein PDF/A-1b. Der Versand konvertiert es automatisch; in seltenen Fällen kann sich die Darstellung (Schriften, Transparenzen) ändern.",
    });
  }

  // Address-zone analysis (page 1).
  let addressZoneResult: ZoneResult = "ok";
  let needsCoverLetter = false;
  if (isEditor) {
    // Our renderer draws the recipient block into the fixed recipient zone and
    // keeps the DVF strip / margins clear (A-010) — correct by construction, so
    // the heuristic text analysis is skipped and the layout is confirmed.
    rules.push({
      id: "zone_ok",
      severity: "ok",
      message: "Die Empfängeranschrift wird automatisch in der korrekten Adresszone platziert.",
    });
  } else if (pageCount > 0) {
    const zones = await analyzeAddressZones(bytes);
    if (!zones.available) {
      addressZoneResult = "warning";
      needsCoverLetter = true;
      rules.push({
        id: "zone_unknown",
        severity: "warning",
        message:
          "Die Anschriftenzone konnte nicht automatisch geprüft werden – sicherheitshalber ist das Deckblatt mit der Empfängeradresse automatisch aktiviert (+1 Seite).",
      });
    } else {
      if (zones.dvfViolation) {
        // Not a reject: the auto-prepended cover page becomes page 1 and
        // carries address + franking, so the original page no longer has to
        // keep the DVF strip clear (same contract the cover toggle promises).
        addressZoneResult = "fail";
        needsCoverLetter = true;
        rules.push({
          id: "dvf_zone",
          severity: "warning",
          message:
            "Im Frankier-Sperrbereich (Schablone V3) befindet sich Inhalt. Damit die Deutsche Post den Brief annimmt, wird automatisch ein Deckblatt vorangestellt (+1 Seite); es kann für diesen Brief nicht deaktiviert werden.",
        });
      }
      if (zones.marginViolation) {
        if (addressZoneResult === "ok") addressZoneResult = "warning";
        rules.push({
          id: "margin_zone",
          severity: "warning",
          message:
            "Im druckfreien Rand befindet sich Inhalt. Bitte halten Sie 2 mm Rand und 12 mm am linken Seitenrand frei.",
        });
      }
      if (!zones.recipientZoneHasText) {
        needsCoverLetter = true;
        if (addressZoneResult === "ok") addressZoneResult = "warning";
        rules.push({
          id: "recipient_zone_empty",
          severity: "ok",
          message:
            "In der Empfängerzone wurde keine Anschrift erkannt – das Deckblatt mit der Empfängeradresse ist daher automatisch aktiviert (+1 Seite).",
        });
      }
    }
  }

  return {
    pageCount,
    sheetCountSimplex,
    fileSizeBytes,
    isPdfA,
    addressZoneResult,
    needsCoverLetter,
    rules,
  };
}

/** Detects a PDF/A conformance claim in the XMP metadata (pdfaid namespace). */
function detectPdfA(bytes: Uint8Array): boolean {
  // Scan a bounded window for the XMP marker; avoids decoding the whole file.
  const haystack = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 200000)));
  return /pdfaid[:\s]*part/i.test(haystack) || /<pdfaid:part>/i.test(haystack);
}
