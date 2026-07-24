# Canva-Integration einrichten (Betreiber-Anleitung)

Versendio nutzt die **Canva Connect API** (OAuth 2.0 mit PKCE). Dafür wird im
Canva Developer Portal einmalig eine „Integration" angelegt; deren Client-ID
und Client-Secret kommen als Umgebungsvariablen nach Vercel.

## 1. Integration im Canva Developer Portal anlegen

1. <https://www.canva.com/developers> öffnen und mit dem Canva-Konto anmelden
   (idealerweise ein Firmen-Konto, kein privates).
2. Zu **„Your integrations"** gehen → **„Create an integration"**.
3. Typ: **„Public"** wählen (nötig, damit später beliebige Versendio-Kunden
   ihre eigenen Canva-Konten verbinden können). Solange die Integration im
   Status „Draft/In development" ist, kann nur das eigene Canva-Team sie
   nutzen — zum Testen reicht das.
4. **Name** vergeben, z. B. `Versendio`.

## 2. Scopes (Berechtigungen) setzen

Unter **„Scopes"** genau diese zwei aktivieren (Lesen genügt — Versendio
schreibt nichts in Canva):

| Scope | Zweck |
|---|---|
| `design:meta:read` | Design-Liste mit Titeln/Vorschaubildern anzeigen |
| `design:content:read` | Design als PDF exportieren |

## 3. Redirect-URL eintragen

Unter **„Authentication"** als Redirect-URL exakt eintragen:

```
https://app.versendio.de/api/integrations/canva/callback
```

(Für lokale Tests zusätzlich `http://127.0.0.1:3000/api/integrations/canva/callback`
— Canva akzeptiert für localhost auch http.)

## 4. Credentials kopieren

- **Client ID** von der Integrations-Seite kopieren.
- **„Generate secret"** klicken und das Secret (beginnt mit `cnvca…`) sofort
  kopieren — es wird nur einmal angezeigt.

## 5. Umgebungsvariablen in Vercel setzen

```
CANVA_CLIENT_ID=<Client ID>
CANVA_CLIENT_SECRET=<Client Secret>
```

Danach neu deployen. Ohne diese Variablen zeigt die Canva-Kachel einen
„nicht konfiguriert"-Hinweis; sonst ändert sich nichts.

## 6. Testen

1. In Versendio: **Einstellungen → Integrationen → Canva → „Mit Canva
   verbinden"** → Canva-Consent bestätigen.
2. Ein Design im Format **DIN A4 (21 × 29,7 cm)** anlegen (Canva:
   „Benutzerdefinierte Größe" oder Vorlage „A4-Dokument").
3. In Versendio auf **„Als Brief importieren"** — das Design durchläuft die
   normale PDF-Prüfung (A4-Autokorrektur, Adresszonen-Analyse, ggf.
   automatisches Deckblatt) und liegt danach als versandfertiger Brief vor —
   auch in der Brief-Auswahl jedes Flows.

## 7. Für alle Kunden freischalten (später)

Im Draft-Status können nur Mitglieder des eigenen Canva-Teams die Integration
nutzen. Damit **alle** Versendio-Kunden ihre Canva-Konten verbinden können,
muss die Integration im Developer Portal zur **Review bei Canva eingereicht**
werden („Submit for review"); nach Freigabe steht sie öffentlich zur
Verfügung. Bis dahin funktioniert alles uneingeschränkt für das eigene Team.

## Technische Referenz (implementiert in `src/lib/server/canva/`)

- Authorize: `https://www.canva.com/api/oauth/authorize` (PKCE S256, State-Cookie)
- Token: `POST https://api.canva.com/rest/v1/oauth/token` (Basic-Auth; Access-Token ~4 h,
  Refresh-Token einmalig verwendbar → Rotation wird persistiert, verschlüsselt in `canva_accounts`)
- Designs: `GET /rest/v1/designs` · Export: `POST /rest/v1/exports` (`{type:"pdf", size:"a4"}`) + Job-Polling
- Rate Limits Export: 75/5 min pro Nutzer — für Einzel-Importe irrelevant
