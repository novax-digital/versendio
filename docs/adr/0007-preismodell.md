# ADR-0007: Preismodell — Optionsmatrix, Rabatte, Snapshots

**Status:** akzeptiert · **Datum:** 2026-07-09

## Kontext
Preisliste der Post (EK) staffelt nach Blattzahl × Farbe × Duplex + Zuschläge (Einschreiben). Wir verkaufen mit Marge (VK, admin-gepflegt), optional Plan-Rabatte. Historische Jobs müssen preisstabil bleiben.

## Entscheidung
1. **`pricing_table` als Options-Zeilen mit `option_key`:**
   - `tier_{standard|kompakt|gross}_{bw|color}_{simplex|duplex}` — 12 Zeilen, Grundpreis der Stufe (Standard ≤ 1 Blatt, Kompakt ≤ 4, Groß ≤ 10),
   - `extra_sheet_{bw|color}_{simplex|duplex}` — 4 Zeilen, je weiteres Blatt ab dem 11.,
   - `surcharge_registered_{einwurf|einschreiben|rueckschein}` — 3 Zeilen, EK zunächst NULL (TODO, DP-Verzeichnis „Leistungen und Preise“),
   - `zone national|international` — international zunächst inaktiv (Preisliste fehlt), Struktur vorhanden.
   EK-Seeds aus `docs/reference/epost/preisliste-api-2025.md`; VK-Seeds = EK + Startmarge (Vorschlag: +40 % gerundet auf volle 5 Cent — Admin passt an). `ek_cents NULL` → Admin-Warnung „EK fehlt“, Marge n/a.
2. **Berechnung** (`lib/server/pricing/calculate.ts`, pure Function, unit-getestet):
   `sheets = isDuplex ? ceil(pages/2) : pages` (+1 Blatt bei Deckblatt) → Stufe nach Blattzahl → Grundpreis + `max(0, sheets−10) ×` extra_sheet + Einschreiben-Zuschlag → **VK je Brief**; Plan-Rabatt: `vk_rabattiert = round(vk × (1 − discount_percent/100))`, Rabatt wirkt nur auf VK, nie auf EK; × Empfängerzahl = Jobsumme. Alles Integer-Cent, Rundung half-up je Brief.
3. **Snapshot:** beim Job-Anlegen wird je Item `vk_cents`, `ek_cents` und `pricing_snapshot` (verwendete option_keys, Blattzahl, Rabatt) festgeschrieben. Preistabellen-Änderungen wirken nur auf neue Jobs. Rohertrag-Reporting = Σ(vk−ek) über Items mit Status `sent` (nur Status 4 wird von der Post berechnet; Refunds neutralisieren VK bei 99ern).
4. **Gewichtsgrenzen** (20/50/500 g) werden nicht separat modelliert: Blattgrenzen bilden sie bei 80-g-Papier ab (ASSUMPTIONS A-003). Limit 94 Blatt validiert die PDF-Pipeline.
5. **Admin-Preisverwaltung:** EK/VK je Zeile editierbar, Margen-Anzeige (absolut + %), Warnung bei VK < EK; Aufladebeträge/Mindestbetrag in `app_settings`.

## Konsequenzen
- Preisberechnung ist deterministisch und testbar (reine Funktion über Preistabellen-Rows).
- Kostenvorschau (Wizard) und tatsächliche Buchung nutzen dieselbe Funktion — keine zwei Preiswahrheiten.
- Neue Optionen (z. B. weitere Zuschläge, internationale Zonen) sind neue Zeilen, kein Schemawechsel.
