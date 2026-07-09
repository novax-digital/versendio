# ASSUMPTIONS & DECISIONS

> Eigenständig getroffene Entscheidungen mit Begründung. Architektur-Grundsatzentscheidungen zusätzlich als ADR in `docs/adr/`.

## A-001 — Legacy-Ordner heißt `old_app/`, nicht `legacy/`
Der Masterprompt referenziert `./legacy/`, im Repo liegt die alte Codebase unter `./old_app/` (per P.S. im Masterprompt bestätigt). Alle Referenzen wurden auf `old_app/` angepasst. `old_app/` ist via `.gitignore` vom neuen Repo ausgeschlossen (enthält eine eigene `.env` mit Secrets und ~200k Zeilen Lockfile — reine Referenz, kein Bestandteil des Produkts).

## A-002 — EK-Preise aus vorliegender Preisliste übernommen
Der Masterprompt sagt „EK-Werte der Post werden später nachgetragen“. Die per Anhang bereitgestellte Preisliste (gültig ab 01.01.2025, Kunde Novax Digital GmbH) enthält die nationalen EK-Preise bereits → sie werden direkt als Seed-Werte verwendet (siehe `docs/reference/epost/preisliste-api-2025.md`). Nur Einschreiben-Zuschläge und International bleiben TODO-Platzhalter.

## A-003 — Porto-Stufen nach Blattzahl
Preisliste staffelt nach Blatt (Standard inkl. 1 Blatt / Kompakt inkl. 4 / Groß inkl. 10, danach je weiteres Blatt). Blattzahl = Seiten bei Simplex, ⌈Seiten/2⌉ bei Duplex. Gewichtsgrenzen (20/50/500 g) werden bei Standard-80-g-Papier durch die Blattgrenzen abgedeckt; wir rechnen daher blattbasiert.

## A-005 — `old_app/src/styles.css` durch Tooling verändert
`shadcn init` hat beim Setup versehentlich die CSS-Datei der Legacy-App als Ziel erkannt und deren Farbwerte auf das Neutral-Theme überschrieben (Original-Brandfarben nicht wiederherstellbar). Folgenlos: `old_app/` wird hier nie gebaut und ist gitignored; alle relevanten Legacy-Erkenntnisse sind in `docs/LEGACY_FINDINGS.md` gesichert. `components.json` wurde auf `src/app/globals.css` korrigiert.

## A-006 — Gesperrte Nutzer dürfen einloggen (Spec vor Security-Finding)
Das Phase-2-Security-Review empfahl, gesperrte Nutzer (`status=blocked`) hart auszusperren. MASTERPROMPT §6.1 verlangt jedoch ausdrücklich: „Gesperrte Nutzer können sich einloggen, aber nichts versenden — mit klarem Hinweis.“ Umsetzung daher: Login und App-Zugang bleiben offen, ein Banner weist auf die Sperre hin; die **Durchsetzung liegt auf den sensiblen Aktionen** (Upload, Versand, Aufladung) via `blockedActionError()` in `src/lib/server/auth-context.ts`. Diese Aktionen entstehen ab Phase 3/5 — der Guard ist bereitgestellt und wird dort verdrahtet.

## A-004 — Schablone V3: Sicherheitsabstand im Editor-Rendering
Die Schablone warnt davor, Zonen bis zum Rand auszureizen (Brief kann im Umschlag verrutschen). Unser Editor-Rendering setzt Adress-/Absenderzeilen mit ≥ 2 mm Innenabstand zur Zonengrenze.
