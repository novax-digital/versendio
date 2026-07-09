# ADR-0006: PDF-Pipeline — ein Validierungspfad für Upload und Editor

**Status:** akzeptiert · **Datum:** 2026-07-09

## Kontext
Zwei Erstellungswege (PDF-Upload, Block-Editor) müssen im selben validierten Format bei der API landen. Die Legacy-App validierte Uploads gar nicht (größte Lücke), hatte aber einen korrekten Schablonen-Generator. Serienbriefe erfordern Personalisierung pro Empfänger zum Versandzeitpunkt.

## Entscheidung
1. **Ein gemeinsamer Validierungspfad** `validateLetterPdf(bytes)` (pdf-lib, `lib/server/pdf/validate.ts`) für beide Wege. Prüfungen mit Ergebnis je Regel (`ok|warning|error`):
   - Seitenformat **exakt** A4 hoch: MediaBox `[595.276, 841.89]` mit Toleranz ≤ 0,01 pt — die API lehnt bereits `595.28` mit W208 ab (LEGACY_FINDINGS §4), eine großzügige Toleranz würde PDFs durchwinken, die später beim Provider scheitern. Abweichende Uploads → Fehler mit zwei angebotenen Auswegen: (a) automatische MediaBox-Normalisierung per pdf-lib als expliziter Nutzer-Schritt mit erneuter Vorschau + Zonen-Prüfung, (b) Deckblatt/Neuerstellung. Editor-Ausgabe ist konstruktionsbedingt exakt,
   - Seitenzahl ≤ 94 Blatt (simplex: 94 Seiten, duplex: 188), Datei ≤ 20 MB,
   - verschlüsselte/beschädigte PDFs → Fehler,
   - PDF/A-1b-Heuristik (XMP-Marker): kein PDF/A → **Warnung** (API konvertiert automatisch, Font-/Transparenz-Risiko),
   - **Adresszonen-Analyse Seite 1** (Text- und Grafik-Operatoren positional auswerten): Inhalt in der DVF-Sperrzone (y 52–68 mm) → **harter Fehler** (API lehnt ab, Schablone V3); Inhalt im 12-mm-Streifen links oder 2-mm-Rand → harter Fehler (E302); Empfängerzone (y 69–90 mm) leer → Hinweis „Deckblatt nötig“; Zonen-Geometrie zentral aus `lib/shared/schablone.ts` (Werte aus `docs/reference/epost/schablone-v3.md`).
   - dpi-Prüfung eingebetteter Bilder (> 300 dpi → Warnung, kein Blocker).
2. **Deckblatt-Option:** eigenes Deckblatt per pdf-lib (Absenderzeile + Empfängerblock gemäß Schablone) dem Dokument vorangestellt (+1 Blatt, fließt in den Preis ein). Die API-Option `coverLetter` bleibt als Fallback im Adapter verfügbar; eigenes Deckblatt ist Default (WYSIWYG in der Vorschau, identisch im Mock).
3. **Editor-Rendering serverseitig** (`lib/server/pdf/render-editor.ts`, pdf-lib): Blockmodell (`editor_document jsonb`, versioniert `{ version: 1, blocks: [...] }`) → A4-PDF mit Schablonen-Geometrie; Standardfont Helvetica (metrisch kompatible Arial-Alternative; eingebettete Custom-Fonts später). Kein Zeichnen in Sperrzonen möglich (Editor-Layout erzwingt Zonen). Client-Live-Vorschau ist eine HTML/CSS-Näherung in mm-Maßen; verbindlich ist die Server-Vorschau (gerendertes PDF im Viewer).
4. **Personalisierung zum Versandzeitpunkt:** Platzhalter (`{{anrede}}`, `{{vorname}}`, …) werden je Empfänger im `submit_item`-Job aufgelöst → personalisiertes PDF → **derselbe** `validateLetterPdf` → Storage (`{user_id}/jobs/{job_id}/{item_id}.pdf`) → Einlieferung. Upload-Briefe ohne Platzhalter verwenden dasselbe PDF für alle Items (ein Storage-Objekt, ggf. + Deckblatt je Empfänger).
   - Für die **Kostenvorschau und die Job-Bestätigung** wird die Blattzahl anhand eines Proberenderings mit dem längsten Empfänger-Datensatz bestimmt (obere Schranke). Weicht die tatsächliche Blattzahl eines Items beim Rendern ab, wird die Differenz **vor** der Einlieferung als `item_render_adjust` gebucht (ADR-0003 §3 — eigener reference_type, kollidiert nie mit der Fehler-Erstattung `item_failed`):
     - *Weniger Blätter (Regelfall, da Schätzung = Maximum):* Refund der Differenz, dann Einlieferung.
     - *Mehr Blätter + Guthaben reicht:* Nachbelastung der Differenz, dann Einlieferung.
     - *Mehr Blätter + Guthaben reicht nicht:* **kein Versand unbezahlter Briefe.** Item → Status `on_hold_funds` (bereits belastete Schätzung bleibt gebucht, keine Auto-Erstattung), Nutzer-Mail „Guthaben reicht nicht, N Briefe zurückgestellt“, Anzeige im Job-Monitor. Eine erfolgreiche Aufladung (Webhook bzw. Admin-Buchung) setzt gehaltene Items zurück auf `pending` und enqueued neue `submit_item`-Jobs — nur so passieren sie den Status-Guard aus ADR-0004 §5.1 wieder; alternativ kann der Nutzer die Items stornieren (→ `item_canceled`-Refund der Schätzung).
     Pflicht-Tests in Phase 5: alle drei Zweige inkl. „heruntergebucht → später Status 99 → beide Buchungen vorhanden“.
5. **Browser-Vorschau** mit pdf.js/react-pdf; Overlay der Zonen (Absender/DVF/Empfänger/Ränder) als einblendbare Ebene — sowohl im Upload-Check als auch im Editor.

## Konsequenzen
- Kein PDF erreicht den Provider ohne `validateLetterPdf` (Invariante, im Adapter erzwungen).
- Editor-Briefe und Uploads sind ab Validierung ununterscheidbar → Wizard/Versand/Preislogik einheitlich.
- Die Zonen-Analyse von Bestands-PDFs ist heuristisch (Textoperatoren) — Grenzfälle führen zu Warnung + Deckblatt-Empfehlung statt harter Ablehnung; die API bleibt letzte Instanz, ihr Fehler wird sauber angezeigt.
