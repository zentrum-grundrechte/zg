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

// Kalenderdatum in Berlin (als UTC-Mitternacht), sommerzeitfest via Intl.
const BERLIN_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
});
function todayBerlin(now = new Date()) {
  const [y, m, d] = BERLIN_DATE.format(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(d, n) { return new Date(d.getTime() + n * 24 * 60 * 60 * 1000); }

// Wie viele Tage im Voraus die Admin-Übersicht fällige Einzüge auflistet
// (damit genug Zeit bleibt, die Lastschrift in FYRST einzureichen).
const ADMIN_LOOKAHEAD_DAYS = 3;

const RHYTHM_MONTHS = { monatlich: 1, vierteljaehrlich: 3, jaehrlich: 12 };
const RHYTHM_LABEL = {
  einmalig: 'einmalig',
  monatlich: 'monatlich',
  vierteljaehrlich: 'vierteljährlich',
  jaehrlich: 'jährlich'
};

// Startdatum + n Monate; existiert der Tag im Zielmonat nicht (29.–31.),
// wird auf den Monatsletzten gekappt. Wird immer vom ursprünglichen
// Startdatum aus gerechnet, damit sich der Tag nicht dauerhaft verschiebt
// (31.01. → 28.02. → 31.03. → 30.04. …).
function addMonthsClamped(start, months) {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(start.getUTCDate(), lastDay)));
}

// Gibt das nächste Belastungsdatum zurück, das ≥ from ist (als UTC-Date),
// oder null wenn einmalig und bereits vorbei.
function nextDebitDate(startdatum, rhythmus, from) {
  const start = new Date(startdatum + 'T00:00:00Z');
  if (isNaN(start)) return null;
  if (rhythmus === 'einmalig') {
    return start >= from ? start : null;
  }
  const monthStep = RHYTHM_MONTHS[rhythmus];
  if (!monthStep) return null;
  for (let k = 0; k < 2400; k++) {
    const d = addMonthsClamped(start, k * monthStep);
    if (d >= from) return d;
  }
  return null;
}

// Lastschrift-Art für die Einreichung bei der Bank
function sequenceLabel(record, debitDate) {
  if (record.data.rhythmus === 'einmalig') return 'Einmalig (OOFF)';
  return isoDate(debitDate) === record.data.startdatum ? 'Erstlastschrift (FRST)' : 'Folgelastschrift (RCUR)';
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

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function groupIban(iban) { return String(iban).match(/.{1,4}/g).join(' '); }

// DE53100703990079420600 → "DE53 **** **** **** **06 00"
function maskIban(iban) {
  const s = String(iban).replace(/\s+/g, '');
  if (s.length <= 8) return groupIban(s);
  return groupIban(s.slice(0, 4) + '*'.repeat(s.length - 8) + s.slice(-4));
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
  const name = escapeHtml(`${d.vorname} ${d.nachname}`);
  const iban = maskIban(d.iban);
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

function renderAdminDigestHtml(upcoming, tomorrow) {
  const rows = upcoming.map(u => {
    const d = u.record.data;
    const due = sameDate(u.debitDate, tomorrow);
    return `<tr${due ? ' style="background:#FFF4F4;"' : ''}>
  <td>${formatGermanDate(u.debitDate)}${due ? ' <strong>(morgen)</strong>' : ''}</td>
  <td>${escapeHtml(d.vorname)} ${escapeHtml(d.nachname)}</td>
  <td style="text-align:right;white-space:nowrap;">${formatEuro(d.betrag)}</td>
  <td style="font-family:monospace;white-space:nowrap;">${groupIban(d.iban)}</td>
  <td style="font-family:monospace;">${escapeHtml(d.bic || '–')}</td>
  <td style="white-space:nowrap;">${escapeHtml(u.record.mandatsref)}</td>
  <td>${u.record.confirmedAt ? formatGermanDate(todayBerlin(new Date(u.record.confirmedAt))) : '–'}</td>
  <td>${sequenceLabel(u.record, u.debitDate)}</td>
</tr>`;
  }).join('\n');
  const sum = upcoming.reduce((a, u) => a + Number(u.record.data.betrag || 0), 0);
  return `<!doctype html><html><body style="font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;color:#3A332F;padding:24px;line-height:1.5;">
<p>Fällige SEPA-Lastschriften in den nächsten ${ADMIN_LOOKAHEAD_DAYS} Tagen (${upcoming.length} Einzug/Einzüge, zusammen ${formatEuro(sum)}).</p>
<p>Bitte spätestens einen Geschäftstag vor Fälligkeit in FYRST einreichen. Die Vorabankündigung an die Spender geht automatisch am Vortag raus.</p>
<table cellpadding="6" style="border-collapse:collapse;font-size:13px;" border="1">
<tr style="background:#FAFAF8;"><th>Fällig am</th><th>Name</th><th>Betrag</th><th>IBAN</th><th>BIC</th><th>Mandatsreferenz</th><th>Mandatsdatum</th><th>Art</th></tr>
${rows}
</table>
</body></html>`;
}

async function runPreNotification(env, now, { dry = false } = {}) {
  const today = todayBerlin(now);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const todayIso = isoDate(today);
  const tomorrowIso = isoDate(tomorrow);
  const horizon = addDays(today, ADMIN_LOOKAHEAD_DAYS);

  const upcoming = [];
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
        const next = nextDebitDate(record.data.startdatum, record.data.rhythmus, tomorrow);
        if (!next) { skipped.push({ ref: record.mandatsref, reason: 'no-next-debit' }); continue; }
        if (next <= horizon) upcoming.push({ record, debitDate: next });
        if (!sameDate(next, tomorrow)) { skipped.push({ ref: record.mandatsref, reason: `next=${isoDate(next)}` }); continue; }

        // Dedup: pro Mandat + Belastungsdatum nur einmal senden
        const dedupKey = `prenotif:${record.mandatsref}:${tomorrowIso}`;
        const already = await env.SEPA_MANDATES.get(dedupKey);
        if (already) { skipped.push({ ref: record.mandatsref, reason: 'already-sent' }); continue; }
        if (dry) { sent.push({ ref: record.mandatsref, email: record.data.email, debitDate: tomorrowIso, dry: true }); continue; }

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

  // Tägliche Übersicht an den Verein (nur wenn etwas ansteht, max. 1×/Tag)
  upcoming.sort((a, b) => a.debitDate - b.debitDate);
  const digest = upcoming.map(u => ({
    ref: u.record.mandatsref, debitDate: isoDate(u.debitDate), betrag: u.record.data.betrag
  }));
  let digestSent = false;
  if (upcoming.length && !dry) {
    const digestKey = `digest:${todayIso}`;
    try {
      if (!(await env.SEPA_MANDATES.get(digestKey))) {
        await sendMail(env, {
          to: env.ADMIN_EMAIL || 'kontakt@zentrumgrundrechte.de',
          subject: `[ZG] Fällige Lastschriften bis ${formatGermanDate(horizon)}: ${upcoming.length}`,
          html: renderAdminDigestHtml(upcoming, tomorrow)
        });
        await env.SEPA_MANDATES.put(digestKey, '1', { expirationTtl: 60 * 60 * 48 });
        digestSent = true;
      }
    } catch (e) {
      errors.push({ key: 'admin-digest', error: String(e && e.message || e) });
    }
  }

  return { today: todayIso, tomorrow: tomorrowIso, dry, sent, skipped, errors, digest, digestSent };
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
  // Nützlich zum Testen: /?token=<CRON_TRIGGER_TOKEN>[&dry=1]
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!env.CRON_TRIGGER_TOKEN || token !== env.CRON_TRIGGER_TOKEN) {
      return new Response('Not found', { status: 404 });
    }
    // ?dry=1 → nur anzeigen, nichts versenden
    const dry = url.searchParams.get('dry') === '1';
    const result = await runPreNotification(env, new Date(), { dry });
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
