import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { A4, MARGINS, ZONES, mmToPt, type ZoneMm } from "@/lib/shared/schablone";
import { DIN_CONTENT } from "@/lib/shared/letter-style";
import { de } from "@/lib/i18n/de";

const GRAY = rgb(0.55, 0.6, 0.67);
const GRAY_FILL = rgb(0.93, 0.94, 0.96);
const RED = rgb(0.86, 0.15, 0.15);
const RED_FILL = rgb(0.99, 0.92, 0.92);
const BLUE = rgb(0.17, 0.29, 0.91);
const INK = rgb(0.06, 0.09, 0.16);

/**
 * Builds the downloadable sample PDF for uploads: the Schablone-V3 address
 * zones and print-free margins drawn on an exact A4 page, with the upload
 * rules spelled out in the body. Uses the SAME zone constants as the
 * validator, so the sample can never drift from what validateLetterPdf checks.
 */
export async function buildMusterPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  // Marker keyword: validateLetterPdf rejects uploads of the sample itself —
  // its zone illustrations are vector ink the carrier would refuse to print.
  pdf.setKeywords(["versendio-muster"]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([A4.widthPt, A4.heightPt]);

  const rect = (zone: ZoneMm, opts: { fill?: ReturnType<typeof rgb>; border: ReturnType<typeof rgb> }) => {
    page.drawRectangle({
      x: mmToPt(zone.x),
      y: A4.heightPt - mmToPt(zone.y + zone.height),
      width: mmToPt(zone.width),
      height: mmToPt(zone.height),
      color: opts.fill,
      borderColor: opts.border,
      borderWidth: 0.75,
      borderDashArray: [3, 2],
    });
  };
  const label = (
    text: string,
    xMm: number,
    yTopMm: number,
    color: ReturnType<typeof rgb>,
    size = 7,
  ) => {
    page.drawText(text, {
      x: mmToPt(xMm),
      y: A4.heightPt - mmToPt(yTopMm) - size * 0.8,
      size,
      font,
      color,
    });
  };

  // Print-free margins (left 12mm strip, top/right/bottom 2mm).
  page.drawRectangle({
    x: 0,
    y: 0,
    width: mmToPt(MARGINS.leftStripMm),
    height: A4.heightPt,
    color: GRAY_FILL,
  });
  page.drawRectangle({ x: 0, y: A4.heightPt - mmToPt(MARGINS.topMm), width: A4.widthPt, height: mmToPt(MARGINS.topMm), color: GRAY_FILL });
  page.drawRectangle({ x: 0, y: 0, width: A4.widthPt, height: mmToPt(MARGINS.bottomMm), color: GRAY_FILL });
  page.drawRectangle({ x: A4.widthPt - mmToPt(MARGINS.rightMm), y: 0, width: mmToPt(MARGINS.rightMm), height: A4.heightPt, color: GRAY_FILL });

  // Address zones (Schablone V3). Labels sit RIGHT OF the zones so the
  // sample itself passes validateLetterPdf (no text inside the DVF zone).
  const labelX = (zone: ZoneMm) => zone.x + zone.width + 3;
  rect(ZONES.senderLine, { border: BLUE });
  label(de.letters.musterZoneSender, labelX(ZONES.senderLine), ZONES.senderLine.y + 1, BLUE);
  rect(ZONES.dvfBlocked, { border: RED, fill: RED_FILL });
  label(de.letters.musterZoneDvf, labelX(ZONES.dvfBlocked), ZONES.dvfBlocked.y + 6, RED, 8);
  rect(ZONES.recipient, { border: BLUE });
  label(de.letters.musterZoneRecipient, labelX(ZONES.recipient), ZONES.recipient.y + 8, BLUE);

  // Title + rules in the body area.
  const left = mmToPt(DIN_CONTENT.leftMm);
  const maxW = mmToPt(DIN_CONTENT.widthMm);
  let yMm = DIN_CONTENT.bodyStartMm;
  page.drawText(de.letters.musterTitle, {
    x: left,
    y: A4.heightPt - mmToPt(yMm) - 12 * 0.8,
    size: 12,
    font: bold,
    color: INK,
  });
  yMm += 8;
  page.drawText(de.letters.musterViewOnly, {
    x: left,
    y: A4.heightPt - mmToPt(yMm) - 9 * 0.8,
    size: 9,
    font: bold,
    color: RED,
  });
  yMm += 9;

  const wrap = (text: string, size: number): string[] => {
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const probe = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(probe, size) > maxW && line) {
        lines.push(line);
        line = word;
      } else {
        line = probe;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  for (const note of de.letters.musterNotes) {
    const lines = wrap(note, 10);
    lines.forEach((line, i) => {
      page.drawText(i === 0 ? `•  ${line}` : line, {
        x: i === 0 ? left : left + font.widthOfTextAtSize("•  ", 10),
        y: A4.heightPt - mmToPt(yMm) - 10 * 0.8,
        size: 10,
        font,
        color: INK,
      });
      yMm += 5.2;
    });
    yMm += 2.5;
  }

  label(de.letters.musterZoneMargins, DIN_CONTENT.leftMm, yMm + 4, GRAY, 8);

  return pdf.save();
}
