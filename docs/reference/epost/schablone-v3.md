# Deutsche Post Briefschablone V3 — BK Standard und BK BZL (v3.1)

> Transkribiert aus: `002_Schablone_V3_API_BK_Standard_und_BK_BZL_neu.pdf`.
> Maßgeblich für PDF-Validierung (Adressfeld, Sperrflächen, Absenderzeile) und
> für das serverseitige Editor-Rendering. Alle Maße in **mm**, Ursprung = linke
> obere Ecke der DIN-A4-Seite (210 × 297 mm).

## Seite 1 (Adressseite)

Layout-Zonen (x = von links, y = von oben):

| Zone | x | y | Breite | Höhe | Inhalt |
|---|---|---|---|---|---|
| Druckfreier Rand links | 0 | 0 | 12 | 297 | keinerlei Druck |
| Druckfreier Rand oben (Adressbereich) | — | 0 | — | 2 | keinerlei Druck |
| **Absenderbereich** | 23 (12+8+3) | 45 | 85 | 5,5 | **genau 1 Zeile, Arial 8 pt** |
| Abstand Absender ↔ DVF | — | 50,5 | — | 1,5 | frei |
| **DVF-Sperrbereich** (Datamatrix/Frankiervermerk) | 23 | 52 | 85 | 16 | NICHTS drucken — API lehnt Verletzung ab |
| Abstand DVF ↔ Empfänger | — | 68 | — | 1 | frei |
| **Empfängerbereich** | 23 | 69 | 85 | 21 | **max. 6 Zeilen, Arial 9 pt** |
| Gesamter Adressblock | 23 | 45 | 85 | 45 | Absender + DVF + Empfänger |

Abgeleitete Kernmaße (aus den Bemaßungen 12 / 8 / 3 / 85 horizontal und 45 / 5,5 / 1,5 / 16 / 1 / 21 (= 45 gesamt) / 90 vertikal):

- Adressblock beginnt bei **x = 23 mm**, ist **85 mm breit**.
- Adressblock beginnt bei **y = 45 mm**, endet bei **y = 90 mm** (Gesamthöhe 45 mm).
- Falzmarke (Z-Falz Typ B): **105 mm** von oben.
- Druckfreier Rand: **2 mm** umlaufend, **12 mm** links (Lochung/Transport).

**Warnhinweis aus der Schablone:** Vorgaben im Adressbereich nicht bis zum Rand ausreizen — durch Bewegung des Briefs im Umschlag können Teile der Empfänger-/Absenderangaben aus dem Sichtfenster rutschen. → Bei eigener PDF-Generierung Sicherheitsabstand einplanen.

## Folge- und Rückseiten

- Nur druckfreier Rand: 2 mm umlaufend, **12 mm links**.
- Keine Adress-/Sperrzonen.
- Falzmarke ebenfalls bei 105 mm (Z-Falz Typ B).

## Konsequenzen für unsere Validierung

1. Erste Seite: Empfängeranschrift muss vollständig in der Zone (23–108 mm x, 69–90 mm y) liegen, max. 6 Zeilen.
2. Einzeilige Absenderzeile in Zone (23–108 mm x, 45–50,5 mm y) — **Pflicht** (fehlend = Ablehnung durch API).
3. DVF-Zone (23–108 mm x, 52–68 mm y) muss **komplett leer** sein.
4. 12-mm-Streifen links auf ALLEN Seiten druckfrei.
5. Wenn Upload-PDF diese Zonen nicht sicher erfüllt → Deckblatt-Option anbieten.
