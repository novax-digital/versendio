# IDEAS — Backlog größerer Verbesserungen

> Ideen mit Aufwand/Nutzen-Einschätzung. Nicht ungefragt umsetzen; kleine risikoarme Ideen werden direkt umgesetzt und hier nicht geführt.

| # | Idee | Nutzen | Aufwand | Quelle |
|---|---|---|---|---|
| I-001 | Nachgelagerte Monats-Sammelabrechnung (Stripe Usage-Based Billing) für Großkunden — nur mit Limits/Bonität wegen Vorfinanzierungsrisiko | Großkunden-Akquise | hoch | Masterprompt 6.6 (nur dokumentieren) |
| I-002 | Unicode-Font (z. B. Liberation Sans/DejaVu via fontkit) im Editor-PDF einbetten statt Standard-Helvetica (WinAnsi) — volle Zeichenabdeckung ohne Transliteration/`?`-Fallback | höhere Renderingtreue bei Sonderzeichen | mittel (Fontdatei + Lizenz + Bundle-Größe) | Phase 3 render-shared.ts |
| I-003 | Editor-PDF-Vorschau als serverseitig gerastertes Seitenbild statt Browser-`iframe`, damit das Zonen-Overlay pixelgenau über dem echten Inhalt liegt | präzisere Adresszonen-Kontrolle | mittel (pdfjs-Canvas/Rasterizer im Node) | Phase 3 letter-preview.tsx |
| I-004 | Reichere Editor-Bausteine (Bild-Blöcke im Editor-UI, Anlagenvermerk, Fußzeile, Rich-Text-Formatierung) — Datenmodell (`image`-Block) ist bereits vorbereitet | mächtigerer Editor | mittel | Phase 3 letter-document.ts |
