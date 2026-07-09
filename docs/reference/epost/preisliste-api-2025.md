# E-POSTBUSINESS API — Preisliste (EK / Einkaufspreise)

> Transkribiert aus: `5290173143-Novax Digital GmbH-A6 - Preisliste API-v1.pdf`
> (Deutsche Post, Stand 15. Oktober 2024, **gültig ab 01.01.2025**).
> Diese Werte sind unsere **Einkaufspreise (EK)** für die `pricing_table`.
> Alle Preise **netto** zzgl. gesetzlicher USt.

## Versandpreise national — E-POST Brief mit physischer Zustellung (inkl. Druck)

| Produkt | S/W einseitig | S/W beidseitig | Farbe einseitig | Farbe beidseitig |
|---|---|---|---|---|
| **Standard** bis 20 g (inkl. 1 Blatt) | 0,80 € | 0,81 € | 0,83 € | 0,90 € |
| **Kompakt** bis 50 g (inkl. 4 Blatt) | 1,12 € | 1,16 € | 1,24 € | 1,52 € |
| **Groß** bis 500 g (inkl. 10 Blatt) | 1,95 € | 2,05 € | 2,25 € | 2,95 € |
| **Jedes weitere Blatt** | 0,04 € | 0,05 € | 0,07 € | 0,14 € |

In Cent (für Seeds):

| Produkt | sw_simplex | sw_duplex | color_simplex | color_duplex |
|---|---|---|---|---|
| standard (≤ 1 Blatt) | 80 | 81 | 83 | 90 |
| kompakt (≤ 4 Blatt) | 112 | 116 | 124 | 152 |
| gross (≤ 10 Blatt) | 195 | 205 | 225 | 295 |
| extra_sheet (je Blatt) | 4 | 5 | 7 | 14 |

Interpretation Porto-Stufen (nach **Blattzahl**, nicht Seiten — 1 Blatt duplex = 2 Seiten):
- 1 Blatt → Standard; 2–4 Blatt → Kompakt; 5–10 Blatt → Groß; 11+ Blatt → Groß + `extra_sheet` × (Blatt − 10).
- Achtung: Stufengrenzen zusätzlich gewichtsbasiert (20 g/50 g/500 g); bei Normalpapier deckt die Blattzahl das ab. Max. 94 Blatt je Brief (API-Limit).

## Zusatzleistungen (Einschreiben etc.)

Zusatzleistungen (z. B. Einschreiben) zu Konditionen des **Brief-Einzelversands** gemäß aktuellem Verzeichnis „Leistungen und Preise“ der Deutschen Post: Entgelt Briefversand + Zusatzleistung zzgl. Druck. Konkrete Einschreiben-EKs sind **nicht** in dieser Preisliste → im Seed als TODO-Platzhalter führen und aus dem aktuellen DP-Verzeichnis nachtragen.

## International

Versand im Einzeltarif gemäß separater „Preisliste International für die E-POSTBUSINESS API“ (liegt nicht vor → EK-TODO; Einschreiben-Rückschein international nicht verfügbar).
