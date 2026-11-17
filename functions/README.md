# SEPA-Lastschrift Backend (Cloudflare Pages Functions)

Dieses Verzeichnis enthält die Serverless-Endpoints für das SEPA-Lastschriftmandat
auf zentrumgrundrechte.de. Läuft als Cloudflare Pages Function im gleichen Projekt
wie die statische Website — keine separate Worker-Deployment nötig.

## Dateien

```
functions/
├── _lib/
│   ├── iban.js      → ISO-13616 IBAN-Validierung (Mod-97 + SEPA-Länder)
│   ├── email.js     → Resend-API-Wrapper
│   └── mandate.js   → Mandats-HTML-Template + Referenzgenerator
└── api/sepa/
    ├── submit.js    → POST  /api/sepa/submit    → Formular entgegennehmen + DOI-Mail
    └── confirm.js   → GET   /api/sepa/confirm?t → Klick-Bestätigung + Mandat raus
```

## Deploy-Setup (einmalig)

### 1. GitHub-Repo in neue ZG-Organization transferieren

Auf **github.com/prometheus2211/zg → Settings → Danger Zone → Transfer ownership**,
Ziel: `zentrum-grundrechte`. Dauert ~30 s, alle Commits bleiben erhalten.

### 2. Brevo-Account (E-Mail-Versand)

ZG nutzt bereits Brevo (für den Newsletter-Aufnahme-Form). Daher:

1. brevo.com → Settings → Senders, Domains → Reiter "Domains" → prüfen, ob
   `zentrumgrundrechte.de` authentifiziert ist; falls nicht, Brevo-DNS-Records
   bei **webgo** einsetzen (DNS liegt nicht auf Cloudflare).
2. Settings → SMTP & API → API Keys → "Generate a new API key" (nur transaktionale
   Mails) → kopieren.

### 3. Cloudflare Pages Projekt anlegen

Im Cloudflare-Dashboard (`kontakt@zentrumgrundrechte.de`, Account
`0a1ebe114f935246158f9714f95f8a9a`):

1. **Workers & Pages → Create → Pages → Connect to Git**
2. GitHub autorisieren → `zentrum-grundrechte/zg` auswählen
3. Build settings:
   - Framework preset: *None*
   - Build command: *leer*
   - Build output directory: `/`
   - Root directory: *leer*
4. **Save and Deploy** → lädt die statische Seite auf `<projektname>.pages.dev`

### 4. KV-Namespace anlegen + binden

1. **Workers & Pages → KV → Create namespace** → Name `sepa-mandates`.
2. Im Pages-Projekt → **Settings → Functions → KV namespace bindings** →
   Variable name `SEPA_MANDATES`, KV namespace `sepa-mandates`.

### 5. Environment Variables setzen

Im Pages-Projekt → **Settings → Environment variables → Production**:

| Variable         | Wert                                                              |
|------------------|-------------------------------------------------------------------|
| `BREVO_API_KEY`  | aus Schritt 2 (als **Secret** markieren)                          |
| `FROM_EMAIL`     | `Zentrum Grundrechte <kontakt@zentrumgrundrechte.de>` *(optional)* |
| `ADMIN_EMAIL`    | `kontakt@zentrumgrundrechte.de` *(optional)*                      |
| `SITE_URL`       | `https://zentrumgrundrechte.de` *(optional)*                      |

Danach: **Deployments → Retry deployment**, damit die neuen Vars gezogen werden.

### 6. Custom Domain binden

Im Pages-Projekt → **Custom domains → Set up a custom domain** →
`zentrumgrundrechte.de`. Cloudflare richtet automatisch den CNAME ein (wenn
die Domain in diesem Cloudflare-Account liegt). Falls die Domain noch bei
einem anderen Registrar hängt: dort CNAME auf `<projekt>.pages.dev` zeigen.

## Test ohne Frontend (einmal durchspielen)

```bash
curl -X POST https://zentrumgrundrechte.de/api/sepa/submit \
  -H 'Content-Type: application/json' \
  -d '{
    "vorname": "Max",
    "nachname": "Muster",
    "strasse": "Teststraße 1",
    "plz": "10115",
    "ort": "Berlin",
    "email": "deine-testadresse@example.com",
    "iban": "DE89370400440532013000",
    "betrag": 100,
    "rhythmus": "monatlich",
    "startdatum": "2026-12-01",
    "bestaetigung": true
  }'
```

Erwartete Antwort: `{"ok":true,"mandatsref":"ZG-2026-XXXXXX"}` + Bestätigungsmail
an die angegebene Adresse. Klick auf den Link → finales Mandats-HTML geht an
Spender und kontakt@.

## Fehlende Phase-2b-Features (für später)

- Echte PDF-Generierung (statt HTML-Mail) via `pdf-lib` oder vergleichbar.
- Fortlaufende Mandatsreferenz (statt zufälliger 6-stelliger Nummer) via
  KV-Counter oder D1.
- `pain.008.001.02`-XML-Export für Sammel-Einreichung bei FYRST.
- Camt.054-Import für Rückläufer-Handling.
- Admin-Interface zum Einsehen aller Mandate (einfache Auth, zugriff nur
  für Vorstand).
- Turnstile/hCaptcha gegen Bot-Submissions.
