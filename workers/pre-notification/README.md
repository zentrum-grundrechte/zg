# zg-pre-notification Worker

Separater Cloudflare Worker, der einmal täglich läuft (Cron 07:00 UTC)
und für alle bestätigten SEPA-Mandate, bei denen morgen ein Einzug
ansteht, eine Vorabankündigung an die Spender-Adresse verschickt.
Erfüllt damit die „spätestens einen Tag vor Belastung"-Zusage aus
unserem Mandatstext.

## Setup im Cloudflare-Dashboard

Pages Functions können keine Cron-Trigger — darum ein getrennter
Worker. Liest dasselbe KV-Namespace wie das Pages-Projekt.

### 1. Worker anlegen

- Cloudflare → **Workers & Pages → Create → Workers → Import a Git repository**
- Repository: `zentrum-grundrechte/zg`
- **Root directory:** `workers/pre-notification`
- **Build command:** leer
- **Build output directory:** leer
- Deploy

### 2. KV-Binding

- Im Worker → **Settings → Variables and Secrets → Bindings → Add → KV Namespace**
- Variable: `SEPA_MANDATES`
- Namespace: `sepa-mandates` (derselbe wie im Pages-Projekt)

### 3. Env Vars

| Variable             | Wert                                                           | Typ    |
|----------------------|----------------------------------------------------------------|--------|
| `BREVO_API_KEY`      | Brevo-Transactional-Key (gleich wie im Pages-Projekt)          | Secret |
| `CRON_TRIGGER_TOKEN` | selbstgewählter Zufalls-String (für manuellen Test-Aufruf)     | Secret |
| `FROM_EMAIL`         | `Zentrum Grundrechte <kontakt@zentrumgrundrechte.de>` *(opt.)* | Plain  |
| `ADMIN_EMAIL`        | `kontakt@zentrumgrundrechte.de` *(optional)*                   | Plain  |

### 4. Cron-Trigger

Wurde durch `wrangler.toml` definiert (`0 7 * * *`), sollte nach
Deploy automatisch im Worker als Trigger auftauchen. Prüfen unter
**Settings → Triggers → Cron Triggers**.

## Manuell testen

```
https://zg-pre-notification.<deine-sub>.workers.dev/?token=<CRON_TRIGGER_TOKEN>
```

Antwort ist ein JSON mit Mandaten, denen heute eine Pre-Notification
rausgegangen wäre (bzw. ging, wenn Mails versendet wurden).

## Logik

- Läuft über alle `mandate:*`-Keys im KV
- Filter: `status === 'confirmed'`
- Berechnet nächstes Belastungsdatum aus `startdatum` + `rhythmus`
- Wenn nächstes Belastungsdatum == morgen (Berliner Zeit): E-Mail raus
- Dedup via `prenotif:<mandatsref>:<yyyymmdd>` (7 Tage TTL) — verhindert
  Doppelversand, falls der Cron zweimal läuft oder manuell getriggert
  wird.
