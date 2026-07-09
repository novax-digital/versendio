# ADR-0008: E-Post-Betriebsmodell — Eigenversender vs. Partner-Modell

**Status:** ✅ **akzeptiert — Checkpoint-Entscheidung vom 2026-07-09: Eigenversender-Modell (b)** · **Datum:** 2026-07-09

## Kontext
Die E-POSTBUSINESS API erlaubt zwei Betriebsweisen (Masterprompt 6.5): **(a) Partner-Modell** — jeder Kunde bringt eine eigene DP-Kundennummer (EKP) mit und aktiviert sie per SMS-TAN in unserer App; die Post rechnet direkt mit dem Kunden ab. **(b) Eigenversender-Modell** — ein zentraler Account (unsere EKP aus ENV), alle Sendungen laufen darüber; Zuordnung je Kunde über `costCenter` auf unserer DP-Monatsrechnung.

## Empfehlung: **Eigenversender-Modell (b)**

**Begründung:**
1. **Nur (b) passt zum Geschäftsmodell.** §6.6 definiert Prepaid-Guthaben mit VK/EK-Marge je Brief. Beim Partner-Modell bezahlt der Kunde das Porto direkt an die Post — wir könnten kein VK berechnen (Doppelabrechnung) und hätten keine Marge; das gesamte Pricing-/Ledger-/Rohertragskonzept liefe leer.
2. **Onboarding-Reibung:** Partner-Modell verlangt je Kunde einen eigenen DP-API-Vertrag + EKP + SMS-Aktivierung — für die Zielgruppe (KMU, „Registrierung → aufladen → versenden“) ein Abbruchrisiko; beim Eigenversender ist der Kunde nach der E-Mail-Verifizierung versandbereit.
3. **Betrieb:** ein Token, eine Frequenz-Drosselung, ein Health-Status; die Legacy-App lief de facto bereits so (ein zentraler Account, LEGACY_FINDINGS §4). Vertrag/EKP der Novax Digital GmbH existieren (Preisliste liegt vor).
4. **Risiken von (b) und deren Behandlung:**
   - *Vorfinanzierung:* Wir zahlen die DP-Monatsrechnung; Kunden zahlen prepaid → Risiko klein, da Guthaben vor Versand gebucht wird.
   - *Zuordnung:* `costCenter = ep-{user_kurzid}` je Einlieferung für die Rechnungskontrolle; zusätzlich internes EK-Reporting je Item.
   - *Missbrauch über unsere EKP* (Inhalte gehen unter unserem Absendervertrag raus): AGB-Klausel + Sperrfunktion + Audit; technisch erzwungene korrekte Absenderzeile je Kunde.

## Architektur-Vorsorge (bereits eingeplant, unabhängig von der Entscheidung)
- `epost_accounts`-Tabelle + Verschlüsselung (ADR-0005) bleiben im Schema → Partner-Modell ist später **additiv** nachrüstbar (Aktivierungs-Flow existiert als Referenz in der Legacy-App).
- `LetterProvider` erhält die Credentials als Parameter (Account-Auflösung: User-Account, sonst zentraler ENV-Account) — kein Refactoring nötig, falls (a) später für Großkunden kommt.
- Auswirkung auf Datenmodell/Onboarding/Abrechnung bei (b): kein Aktivierungsschritt im User-Onboarding; Abrechnung rein über unser Ledger; `epost_accounts` bleibt leer bis auf ggf. Testeinträge.

## Entscheidung
**Am Phase-1-Checkpoint (2026-07-09) vom Product Owner bestätigt: Eigenversender-Modell (b).** Zentraler Account aus ENV (`EPOST_VENDOR_ID`, `EPOST_EKP`, `EPOST_PASSWORD`, `EPOST_SECRET`), `costCenter` je Kunde. Partner-Modell bleibt als additiv nachrüstbare Ausbaustufe dokumentiert (`epost_accounts`-Tabelle + Aktivierungs-Flow-Referenz in der Legacy-App).
