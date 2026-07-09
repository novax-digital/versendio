# Stripe aktivieren

> Stand: vollständig gegen den **Stripe-Testmodus** implementiert, hinter dem Feature-Flag
> `FEATURE_STRIPE` (Default `false`). Solange das Flag aus ist, bucht der Admin Guthaben manuell
> (Beta-Betrieb) — die Guthaben-Seite zeigt dazu einen Hinweis.

> ⚠️ **Live-Keys sind im Code gesperrt.** `getStripe()` wirft bei einem `sk_live_…`-Key eine
> Ausnahme, ebenso das Seed-Skript. Das ist eine bewusste Sicherung gegen versehentliche
> Echtzahlungen und muss beim echten Go-live in `src/lib/server/stripe.ts` bewusst entfernt werden.

---

## 1. Testmodus einrichten

### Schritt 1 — Keys eintragen

Stripe-Dashboard → **Developers → API keys** (Testmodus):

```bash
STRIPE_SECRET_KEY=sk_test_…
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…
FEATURE_STRIPE=true
APP_URL=https://…            # in Produktion Pflicht (Success-/Cancel-URLs)
```

### Schritt 2 — Produkt anlegen

```bash
npm run seed:stripe
```

Idempotent: legt das Produkt „Guthaben-Aufladung" an, falls es fehlt, und verweigert Live-Keys.
Das Produkt dient nur der lesbaren Benennung auf Belegen; die Beträge sind dynamisch.

### Schritt 3 — Webhook einrichten

Stripe-Dashboard → **Developers → Webhooks → Add endpoint**:

- **Endpoint:** `<APP_URL>/api/webhooks/stripe`
- **Events:**
  - `checkout.session.completed`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
- Signing-Secret kopieren → `STRIPE_WEBHOOK_SECRET=whsec_…`

Lokal testen:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# das ausgegebene whsec_… in .env.local eintragen
stripe trigger checkout.session.completed
```

### Schritt 4 — Zahlungsmethoden

Dashboard → **Settings → Payment methods**: **Karte** und **SEPA-Lastschrift** aktivieren.
SEPA ist ausdrücklich gewünscht (Flat-Fee statt Prozentgebühr — bei Briefpreisen um 1 € frisst eine
prozentuale Gebühr die Marge).

### Schritt 5 — Steuern (optional, empfohlen)

Dashboard → **Settings → Tax**: Stripe Tax aktivieren, Sitz und Registrierungen eintragen.
Die Anwendung verlangt bereits vor der ersten Aufladung eine vollständige **Rechnungsadresse** im
Profil und erzeugt je Aufladung eine Stripe-Rechnung (`invoice_creation`).

---

## 2. Was aktiviert wird

| Funktion | Verhalten |
|---|---|
| **Guthaben aufladen** | Checkout-Session (Karte + SEPA). Beträge und Mindest-/Höchstbetrag stammen aus `app_settings` (Admin → Einstellungen). |
| **Gutschrift** | **Ausschließlich** über den Webhook, nie über den Redirect. Ledger-Referenz `stripe_event` + `event_id` — doppelte Events können nicht doppelt gutschreiben. |
| **Belege** | Rechnungs- bzw. Beleg-Link wird auf der Ledger-Zeile gespeichert und auf der Guthaben-Seite verlinkt. |
| **Auto-Aufladung** | Setup-Checkout hinterlegt die Zahlungsmethode; fällt das Guthaben unter den Schwellwert, wird off-session nachgeladen. Ein atomarer In-flight-Claim verhindert Doppelbelastungen. SCA-/Ablehnungsfälle lösen eine Mail aus. |
| **Freigabe zurückgestellter Briefe** | Nach jeder Gutschrift werden Briefe im Status `on_hold_funds` automatisch erneut eingeplant. |

## 3. Abnahmetest (Testmodus)

- [ ] Aufladung unter Mindestbetrag → Fehlermeldung, kein Checkout.
- [ ] Aufladung über Höchstbetrag → Fehlermeldung.
- [ ] Aufladung ohne vollständige Rechnungsadresse → Hinweis auf das Profil.
- [ ] Testkarte `4242 4242 4242 4242` → nach dem Webhook erscheint die Gutschrift im Ledger und
      der Beleg-Link funktioniert.
- [ ] **Redirect ohne Webhook** (Webhook kurz deaktivieren): kein Guthaben — der Erfolgs-Toast
      verspricht nur die Verarbeitung.
- [ ] Webhook mit manipulierter Signatur → HTTP 400.
- [ ] Denselben Event zweimal senden (`stripe events resend <id>`) → **eine** Gutschrift.
- [ ] Event, dessen Verarbeitung fehlschlug, erneut senden → wird **erneut verarbeitet**
      (nur `processed` gilt als endgültig erledigt).
- [ ] SCA-Testkarte `4000 0025 0000 3155` bei Auto-Aufladung → Fehlermail, Flag zurückgesetzt.
- [ ] Aufladung bei zurückgestelltem Brief (`on_hold_funds`) → Brief wird versendet.

## 4. Live-Schaltung

1. Abnahmetest vollständig bestanden.
2. Rechtsseiten (AGB, Datenschutz, Impressum, AVV) mit echten Inhalten füllen — Platzhalter sind
   im Repository markiert.
3. Steuerliche Behandlung klären (Stripe Tax konfiguriert, USt-Ausweis auf den Belegen korrekt).
4. **Live-Key-Sperre in `src/lib/server/stripe.ts` entfernen** (`getStripe()` und `seed-stripe.ts`).
5. Live-Keys und Live-Webhook-Secret als Environment-Variablen in Vercel setzen (nur Production).
6. Zuerst mit einer echten Kleinbetrags-Aufladung testen, Beleg prüfen.

## 5. Später (dokumentiert, nicht gebaut)

Nachgelagerte **Monats-Sammelabrechnung** über Stripe Usage-Based Billing für Großkunden
(`docs/IDEAS.md`, I-001). Wegen des Zahlungsausfallrisikos — die Post wird von uns vorfinanziert —
nur mit Kreditlimit und Bonitätsprüfung sinnvoll.
