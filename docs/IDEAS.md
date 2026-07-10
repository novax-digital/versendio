# IDEAS — Backlog größerer Verbesserungen

> Ideen mit Aufwand/Nutzen-Einschätzung. Nicht ungefragt umsetzen; kleine risikoarme Ideen werden direkt umgesetzt und hier nicht geführt.

| # | Idee | Nutzen | Aufwand | Quelle |
|---|---|---|---|---|
| I-001 | Nachgelagerte Monats-Sammelabrechnung (Stripe Usage-Based Billing) für Großkunden — nur mit Limits/Bonität wegen Vorfinanzierungsrisiko | Großkunden-Akquise | hoch | Masterprompt 6.6 (nur dokumentieren) |
| I-002 | Unicode-Font (z. B. Liberation Sans/DejaVu via fontkit) im Editor-PDF einbetten statt Standard-Helvetica (WinAnsi) — volle Zeichenabdeckung ohne Transliteration/`?`-Fallback | höhere Renderingtreue bei Sonderzeichen | mittel (Fontdatei + Lizenz + Bundle-Größe) | Phase 3 render-shared.ts |
| I-003 | Editor-PDF-Vorschau als serverseitig gerastertes Seitenbild statt Browser-`iframe`, damit das Zonen-Overlay pixelgenau über dem echten Inhalt liegt | präzisere Adresszonen-Kontrolle | mittel (pdfjs-Canvas/Rasterizer im Node) | Phase 3 letter-preview.tsx |
| I-004 | Reichere Editor-Bausteine (Bild-Blöcke im Editor-UI, Anlagenvermerk, Fußzeile, Rich-Text-Formatierung) — Datenmodell (`image`-Block) ist bereits vorbereitet | mächtigerer Editor | mittel | Phase 3 letter-document.ts |
| I-005 | Land als Auswahlliste (ISO-Länder) statt 2-stelligem Freitext; Anrede als Select — in Kontakt-, Absender- und Rechnungsadress-Formularen | weniger Eingabefehler | niedrig-mittel | Phase-8 UX-Review |
| I-006 | Aufgeschlüsselte Kostenvorschau (Grundpreis, Farbzuschlag, Einschreiben, Rabatt) statt nur „Preis je Brief" | Preistransparenz | niedrig (Breakdown liegt bereits in `PriceBreakdown.optionKeys` vor) | Phase-8 UX-Review |
| I-007 | Niedrig-Guthaben-Banner in der App-Shell (Schwellwert `low_credit_threshold_cents` existiert bereits) + „Diese Liste versenden"-Schnellaktion in der Leadlisten-Detailansicht | weniger Abbrüche vor dem Versand | niedrig | Phase-8 UX-Review |
| I-008 | Schrittanzeige „Schritt X von 3" im Import-Wizard analog zum Versand-Assistenten | Orientierung | niedrig | Phase-8 UX-Review |
| I-009 | Rate-Limiter für Auth-/Löschpfade fail-closed statt fail-open betreiben (aktuell: DB-Ausfall deaktiviert die Drosselung stillschweigend) | Brute-Force-Schutz auch bei DB-Störung | niedrig, aber Verfügbarkeits-Trade-off | Phase-8 Security-Audit (LOW 4) |
| I-010 | Ad-hoc-Statusfarben (`emerald-*`/`amber-*`/`red-*`-Klassen, ~60 Stellen) auf die semantischen Tokens `success`/`warning`/`destructive` migrieren; Status immer als Punkt + Text (Brandbook) | konsistente Statusfarben, Dark-Mode-sicher | niedrig-mittel | Brandbook-Umsetzung 2026-07-10 |
