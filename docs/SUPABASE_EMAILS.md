# Supabase-Auth-Mails (deutsch, gebrandet)

Diese E-Mails versendet **Supabase** (nicht unser Code): Registrierungs­bestätigung und
Passwort-zurücksetzen. Standard-Supabase-Templates sind englisch und ungebrandet — bitte einmalig
im Dashboard ersetzen:

**Supabase-Dashboard → Authentication → Emails** (bzw. Email Templates). Betreff **und** Inhalt je
Template eintragen. Die Platzhalter wie `{{ .ConfirmationURL }}` bleiben unverändert — Supabase
ersetzt sie beim Versand.

> Hinweis: Die Absenderadresse/-domain wird unter **Authentication → SMTP Settings** gesetzt
> (eigener SMTP/Resend für Zustellbarkeit empfohlen; sonst nutzt Supabase seinen Standard-Absender).

Das folgende HTML entspricht dem Branding unserer transaktionalen Mails (`renderBrandedEmail`).

---

## 1. Registrierung bestätigen (Confirm signup)

**Betreff:**
```
Bitte bestätigen Sie Ihre Registrierung – Versendio
```

**Inhalt (HTML):**
```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0">
      <tr><td style="padding:20px 28px;border-bottom:1px solid #eef1fe">
        <span style="font-size:18px;font-weight:600;color:#101828">Versendio</span>
      </td></tr>
      <tr><td style="padding:28px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#101828">Guten Tag,</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#101828">willkommen bei Versendio! Bitte bestätigen Sie Ihre E-Mail-Adresse, um Ihr Konto zu aktivieren.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr><td style="border-radius:8px;background:#2C4BE8">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:10px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">E-Mail-Adresse bestätigen</a>
        </td></tr></table>
        <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#64748B">Falls der Button nicht funktioniert, öffnen Sie diesen Link:<br><a href="{{ .ConfirmationURL }}" style="color:#2C4BE8">{{ .ConfirmationURL }}</a></p>
        <p style="margin:20px 0 0;font-size:15px;line-height:1.6;color:#101828">Mit freundlichen Grüßen<br>Versendio</p>
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #eef1fe">
        <p style="margin:0;font-size:12px;line-height:1.5;color:#64748B">Sie haben diese E-Mail erhalten, weil mit Ihrer Adresse ein Versendio-Konto angelegt wurde. Falls Sie das nicht waren, ignorieren Sie diese E-Mail.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

---

## 2. Passwort zurücksetzen (Reset password)

**Betreff:**
```
Passwort zurücksetzen – Versendio
```

**Inhalt (HTML):**
```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0">
      <tr><td style="padding:20px 28px;border-bottom:1px solid #eef1fe">
        <span style="font-size:18px;font-weight:600;color:#101828">Versendio</span>
      </td></tr>
      <tr><td style="padding:28px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#101828">Guten Tag,</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#101828">für Ihr Versendio-Konto wurde das Zurücksetzen des Passworts angefordert. Klicken Sie auf den folgenden Button, um ein neues Passwort zu vergeben.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr><td style="border-radius:8px;background:#2C4BE8">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:10px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">Neues Passwort vergeben</a>
        </td></tr></table>
        <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#64748B">Falls der Button nicht funktioniert, öffnen Sie diesen Link:<br><a href="{{ .ConfirmationURL }}" style="color:#2C4BE8">{{ .ConfirmationURL }}</a></p>
        <p style="margin:20px 0 0;font-size:15px;line-height:1.6;color:#101828">Mit freundlichen Grüßen<br>Versendio</p>
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #eef1fe">
        <p style="margin:0;font-size:12px;line-height:1.5;color:#64748B">Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren – Ihr Passwort bleibt unverändert.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

---

## Optionale weitere Templates

Die App nutzt sie derzeit nicht, im Dashboard aber ebenfalls vorhanden — bei Bedarf analog eindeutschen:
**Magic Link**, **Change Email Address**, **Reauthentication**. Struktur wie oben, nur Text/Betreff anpassen.
