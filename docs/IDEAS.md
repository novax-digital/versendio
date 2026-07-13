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
| I-011 | Builder-Ausbau: ~~Drag-and-Drop-Sortierung~~ **(umgesetzt 2026-07-13, Redesign)**; offen: Inline-Formatierung (fett im Absatz), freie Akzentfarbe, mm-genaue Seitenumbruch-Marker, Mobile-Bearbeitung (Bottom-Sheet ≥16px) | runderes Builder-Erlebnis | mittel | Builder v2, 2026-07-10 |
| I-012 | KI-Entwurf: Micro-Debit pro Entwurf aus dem Guthaben (z. B. 5 ct) sobald echte Nutzungsdaten vorliegen; Admin-Dashboard-Karte (Entwürfe heute/7 Tage, Top-Nutzer, Token-Kosten aus ai_draft_log) | Kostendeckung + Sichtbarkeit | niedrig-mittel | Builder v2, 2026-07-10 |
| I-013 | S/W-Vorschau-Toggle im Canvas (Briefe ohne Farboption drucken in Graustufen) und Client-seitige Glyph-Warnung live beim Tippen | weniger Überraschungen beim Druck | niedrig | Builder v2, 2026-07-10 |
| I-014 | Asset-Garbage-Collection: verwaiste Logos/Bilder im assets-Bucket aufräumen (Referenzen aus editor_document sammeln, Rest im Maintenance-Cron löschen); Alerting auf `letter_font_embed_failed` (Brief würde in Helvetica statt gewählter Schrift gedruckt) | Speicherhygiene + Druckqualität | niedrig-mittel | Review Builder v2 |
| I-015 | ~~Dirty-Guard auch für In-App-Navigation~~ **umgesetzt 2026-07-13** (Capture-Phase-Interceptor + Speichern-und-verlassen-Dialog) | kein Datenverlust über Sidebar-Links | — | Review Builder v2 |
| I-016 | ~~Auto-Aufladung auf Stripe-Invoicing umstellen~~ **umgesetzt 2026-07-13** (Invoice-Item mit Tax Rate, invoice.paid-Webhook) | korrekter Steuerausweis für alle Zahlungen | — | B2B-Netto-Umstellung 2026-07-13 |
| I-017 | EU-Kunden: Reverse-Charge/USt-ID-Prüfung via Stripe Tax (automatic_tax + Registrierungen) statt fester 19 %-Rate | Auslandskunden korrekt besteuern | mittel | B2B-Netto-Umstellung 2026-07-13 |
