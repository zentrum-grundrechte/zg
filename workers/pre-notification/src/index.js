// Cloudflare Worker — Pre-Notification-Cron für SEPA-Mandate.
// Läuft einmal täglich und verschickt Vorabankündigungen für
// Lastschriften, die morgen fällig sind. Liest denselben KV-
// Namespace wie die Pages-Function (SEPA_MANDATES) und nutzt
// dieselbe Brevo-API fürs Mailing.
//
// Env-Bindings (siehe wrangler.toml):
//   SEPA_MANDATES  (KV namespace binding, identisch zu Pages)
//   BREVO_API_KEY  (secret)
//   FROM_EMAIL     (optional, default "Zentrum Grundrechte <kontakt@zentrumgrundrechte.de>")
//   ADMIN_EMAIL    (optional, default "kontakt@zentrumgrundrechte.de")

function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }

// Berlin-Zeit "heute" (TZ-Offset reicht fürs Tagesdatum; Cron läuft fix morgens UTC)
function todayBerlin(now = new Date()) {
  // In Europa ist der Offset +1 (Winter) oder +2 (Sommer). Für ein Tages-
  // Datum reicht +2 — dann sind wir in den Randzeiten auf der "zu späten"
  // Seite statt zu früh (tendenziell erste Mail eher einen Tag zu früh
  // als zu spät, was Pre-Notification erlaubt).
  const d = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const RHYTHM_MONTHS = { monatlich: 1, vierteljaehrlich: 3, jaehrlich: 12 };
const RHYTHM_LABEL = {
  einmalig: 'einmalig',
  monatlich: 'monatlich',
  vierteljaehrlich: 'vierteljährlich',
  jaehrlich: 'jährlich'
};

// Gibt das nächste Belastungsdatum zurück, das ≥ heute ist (als UTC-Date),
// oder null wenn einmalig und bereits vorbei.
function nextDebitDate(startdatum, rhythmus, today) {
  const start = new Date(startdatum + 'T00:00:00Z');
  if (rhythmus === 'einmalig') {
    return start >= today ? start : null;
  }
  const monthStep = RHYTHM_MONTHS[rhythmus];
  if (!monthStep) return null;
  const d = new Date(start);
  while (d < today) {
    d.setUTCMonth(d.getUTCMonth() + monthStep);
  }
  return d;
}

function sameDate(a, b) {
  return a && b && a.getUTCFullYear() === b.getUTCFullYear()
      && a.getUTCMonth() === b.getUTCMonth()
      && a.getUTCDate() === b.getUTCDate();
}

function formatEuro(n) {
  return Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function formatGermanDate(d) {
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

function parseAddress(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, ''), email: m[2] };
  return { email: s };
}

async function sendMail(env, { to, subject, html }) {
  const fromRaw = env.FROM_EMAIL || 'Zentrum Grundrechte <kontakt@zentrumgrundrechte.de>';
  const body = {
    sender: parseAddress(fromRaw),
    to: [{ email: to }],
    subject,
    htmlContent: html
  };
  // Brevo erlaubt keinen Per-Request-Tracking-Opt-out (bestätigt
  // 2026-11-18). Anonymisierung läuft über die Konto-Einstellung.
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Brevo ${res.status}: ${txt}`);
  }
  return res.json();
}

function renderPreNotificationHtml(record, debitDate) {
  const d = record.data;
  const name = `${d.vorname} ${d.nachname}`;
  const iban = d.iban.match(/.{1,4}/g).join(' ');
  return `<!doctype html><html><body style="font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;color:#3A332F;max-width:560px;margin:0 auto;padding:24px;line-height:1.55;">
<p>Liebe/r ${name},</p>
<p>hiermit kündigen wir Ihnen die folgende Lastschrift an, die wir morgen (<strong>${formatGermanDate(debitDate)}</strong>) im Rahmen Ihres SEPA-Mandats einziehen:</p>
<div style="border:1.5px solid #E0E0DC;padding:16px 20px;margin:20px 0;background:#FAFAF8;">
  <div><strong>Betrag:</strong> ${formatEuro(d.betrag)}</div>
  <div><strong>Rhythmus:</strong> ${RHYTHM_LABEL[d.rhythmus] || d.rhythmus}</div>
  <div><strong>Mandatsreferenz:</strong> ${record.mandatsref}</div>
  <div><strong>Gläubiger-ID:</strong> DE04ZZZ00002950443</div>
  <div><strong>Belastetes Konto (IBAN):</strong> <code style="font-family:monospace">${iban}</code></div>
</div>
<p>Bitte stellen Sie sicher, dass Ihr Konto gedeckt ist.</p>
<p>Bei Rückfragen oder wenn Sie das Mandat ändern oder widerrufen möchten, antworten Sie einfach auf diese E-Mail oder schreiben an <a href="mailto:kontakt@zentrumgrundrechte.de">kontakt@zentrumgrundrechte.de</a>.</p>
<p>Vielen Dank für Ihre Unterstützung.</p>
<hr style="border:none;border-top:1px solid #E0E0DC;margin:28px 0;">
<p style="font-size:12px;color:#888;">Zentrum Grundrechte e.V. · Hauptstraße 2b · 13158 Berlin · kontakt@zentrumgrundrechte.de</p>
</body></html>`;
}

async function runPreNotification(env, now) {
  const today = todayBerlin(now);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const todayIso = isoDate(today);
  const tomorrowIso = isoDate(tomorrow);

  const sent = [];
  const skipped = [];
  const errors = [];

  let cursor = undefined;
  do {
    const list = await env.SEPA_MANDATES.list({ prefix: 'mandate:', cursor });
    for (const key of list.keys) {
      try {
        const raw = await env.SEPA_MANDATES.get(key.name);
        if (!raw) continue;
        const record = JSON.parse(raw);
        if (record.status !== 'confirmed') continue;
        const next = nextDebitDate(record.data.startdatum, record.data.rhythmus, today);
        if (!next) { skipped.push({ ref: record.mandatsref, reason: 'no-next-debit' }); continue; }
        if (!sameDate(next, tomorrow)) { skipped.push({ ref: record.mandatsref, reason: `next=${isoDate(next)}` }); continue; }

        // Dedup: pro Mandat + Belastungsdatum nur einmal senden
        const dedupKey = `prenotif:${record.mandatsref}:${tomorrowIso}`;
        const already = await env.SEPA_MANDATES.get(dedupKey);
        if (already) { skipped.push({ ref: record.mandatsref, reason: 'already-sent' }); continue; }

        await sendMail(env, {
          to: record.data.email,
          subject: `Vorabankündigung: Lastschrift am ${formatGermanDate(tomorrow)} (${record.mandatsref})`,
          html: renderPreNotificationHtml(record, tomorrow)
        });
        // Dedup-Marker für 7 Tage
        await env.SEPA_MANDATES.put(dedupKey, '1', { expirationTtl: 60 * 60 * 24 * 7 });
        sent.push({ ref: record.mandatsref, email: record.data.email, debitDate: tomorrowIso });
      } catch (e) {
        errors.push({ key: key.name, error: String(e && e.message || e) });
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  return { today: todayIso, tomorrow: tomorrowIso, sent, skipped, errors };
}

export default {
  // Scheduled-Handler: läuft nach dem Cron aus wrangler.toml.
  async scheduled(event, env, ctx) {
    const result = await runPreNotification(env, new Date());
    console.log('[pre-notification]', JSON.stringify(result));
    // Bei Fehlern den Admin kurz informieren
    if (result.errors.length) {
      try {
        await sendMail(env, {
          to: env.ADMIN_EMAIL || 'kontakt@zentrumgrundrechte.de',
          subject: `[ZG Website] Pre-Notification-Cron: ${result.errors.length} Fehler`,
          html: `<pre style="font-family:monospace;white-space:pre-wrap;">${JSON.stringify(result, null, 2)}</pre>`
        });
      } catch (_) {}
    }
  },
  // HTTP-Handler für manuellen Trigger (Token-geschützt).
  // Nützlich zum Testen: /?token=<CRON_TRIGGER_TOKEN>
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!env.CRON_TRIGGER_TOKEN || token !== env.CRON_TRIGGER_TOKEN) {
      return new Response('Not found', { status: 404 });
    }
    const result = await runPreNotification(env, new Date());
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
