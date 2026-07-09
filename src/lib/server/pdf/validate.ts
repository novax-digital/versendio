import "server-only";
import { PDFDocument } from "pdf-lib";
import { A4, LIMITS } from "@/lib/shared/schablone";
import { sheetsFromPages } from "@/lib/shared/sheets";
import type { PdfValidation, ValidationRule, ZoneResult } from "@/lib/shared/validation-result";
import { analyzeAddressZones } from "./analyze-zones";

// The API rejects A4 boxes that are even fractionally off (595.28 → W208, a
// 0.004pt delta), so the tolerance covers float noise only — anything looser
// would pass PDFs the API later rejects. Our renderer emits the exact values.
const A4_TOLERANCE_PT = 0.003;

/**
 * The single validation path for both uploaded and generated PDFs (ADR-0006).
 * No PDF reaches the provider without passing through here.
 */
export async function validateLetterPdf(bytes: Uint8Array): Promise<PdfValidation> {
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

  // A4 portrait, exact box. Check every page.
  let a4Ok = true;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    if (
      Math.abs(width - A4.widthPt) > A4_TOLERANCE_PT ||
      Math.abs(height - A4.heightPt) > A4_TOLERANCE_PT
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
        "Alle Seiten müssen exaktes DIN A4 Hochformat sein (210 × 297 mm). Bitte passen Sie das Format an oder stellen Sie ein Deckblatt voran.",
    });
  }

  // PDF/A heuristic via XMP metadata marker.
  const isPdfA = detectPdfA(bytes);
  if (!isPdfA) {
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
  if (pageCount > 0) {
    const zones = await analyzeAddressZones(bytes);
    if (!zones.available) {
      addressZoneResult = "warning";
      needsCoverLetter = true;
      rules.push({
        id: "zone_unknown",
        severity: "warning",
        message:
          "Die Anschriftenzone konnte nicht automatisch geprüft werden. Wir empfehlen, ein Deckblatt mit der Adresse voranzustellen.",
      });
    } else {
      if (zones.dvfViolation) {
        addressZoneResult = "fail";
        rules.push({
          id: "dvf_zone",
          severity: "error",
          message:
            "Im Frankier-Sperrbereich (Schablone V3) befindet sich Inhalt. Dieser Bereich muss frei bleiben – bitte anpassen oder Deckblatt voranstellen.",
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
          severity: "warning",
          message:
            "In der Empfängerzone wurde keine Anschrift erkannt. Falls Ihr PDF keine sichtbare Adresse enthält, stellen Sie bitte ein Deckblatt voran.",
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
