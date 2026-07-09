# ASSUMPTIONS & DECISIONS

> Eigenständig getroffene Entscheidungen mit Begründung. Architektur-Grundsatzentscheidungen zusätzlich als ADR in `docs/adr/`.

## A-001 — Legacy-Ordner heißt `old_app/`, nicht `legacy/`
Der Masterprompt referenziert `./legacy/`, im Repo liegt die alte Codebase unter `./old_app/` (per P.S. im Masterprompt bestätigt). Alle Referenzen wurden auf `old_app/` angepasst. `old_app/` ist via `.gitignore` vom neuen Repo ausgeschlossen (enthält eine eigene `.env` mit Secrets und ~200k Zeilen Lockfile — reine Referenz, kein Bestandteil des Produkts).

## A-002 — EK-Preise aus vorliegender Preisliste übernommen
Der Masterprompt sagt „EK-Werte der Post werden später nachgetragen“. Die per Anhang bereitgestellte Preisliste (gültig ab 01.01.2025, Kunde Novax Digital GmbH) enthält die nationalen EK-Preise bereits → sie werden direkt als Seed-Werte verwendet (siehe `docs/reference/epost/preisliste-api-2025.md`). Nur Einschreiben-Zuschläge und International bleiben TODO-Platzhalter.

## A-003 — Porto-Stufen nach Blattzahl
Preisliste staffelt nach Blatt (Standard inkl. 1 Blatt / Kompakt inkl. 4 / Groß inkl. 10, danach je weiteres Blatt). Blattzahl = Seiten bei Simplex, ⌈Seiten/2⌉ bei Duplex. Gewichtsgrenzen (20/50/500 g) werden bei Standard-80-g-Papier durch die Blattgrenzen abgedeckt; wir rechnen daher blattbasiert.

## A-004 — Schablone V3: Sicherheitsabstand im Editor-Rendering
Die Schablone warnt davor, Zonen bis zum Rand auszureizen (Brief kann im Umschlag verrutschen). Unser Editor-Rendering setzt Adress-/Absenderzeilen mit ≥ 2 mm Innenabstand zur Zonengrenze.
