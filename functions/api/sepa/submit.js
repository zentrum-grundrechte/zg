// POST /api/sepa/submit
// Nimmt die Formular-Daten entgegen, validiert, speichert pending in KV,
// schickt Double-Opt-In-Mail an die Spender-Adresse.
//
// Env-Bindings (in Cloudflare Pages settings → Functions → Variables):
//   RESEND_API_KEY (secret)
//   FROM_EMAIL     (optional, default "Zentrum Grundrechte <kontakt@zentrumgrundrechte.de>")
//   ADMIN_EMAIL    (optional, default "kontakt@zentrumgrundrechte.de")
//   SITE_URL       (optional, default "https://zentrumgrundrechte.de")
//   SEPA_MANDATES  (KV namespace binding)

import { validateIban, normalizeIban } from '../../_lib/iban.js';
import { sendMail } from '../../_lib/email.js';
import { generateMandateRef } from '../../_lib/mandate.js';
import { MIN_LEAD_DAYS_SUBMIT, berlinIsoDate, isValidIsoDate, germanDate } from '../../_lib/dates.js';

const RHYTHM = new Set(['einmalig', 'monatlich', 'vierteljaehrlich', 'jaehrlich']);

// Benutzerfreundliche Labels für Fehlermeldungen
const LABELS = {
  vorname: 'Vorname',
  nachname: 'Nachname',
  strasse: 'Straße + Hausnummer',
  plz: 'PLZ',
  ort: 'Ort',
  email: 'E-Mail',
  iban: 'IBAN',
  bic: 'BIC',
  betrag: 'Betrag',
  rhythmus: 'Rhythmus',
  startdatum: 'Erstes Belastungsdatum',
  bestaetigung: 'Ermächtigung'
};
const label = key => LABELS[key] || key;

function bad(status, message) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function requireString(obj, key, { max = 200 } = {}) {
  const v = obj[key];
  if (typeof v !== 'string') throw new Error(`Feld „${label(key)}" fehlt`);
  const t = v.trim();
  if (!t) throw new Error(`Feld „${label(key)}" fehlt`);
  if (t.length > max) throw new Error(`Feld „${label(key)}" zu lang`);
  return t;
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let body;
  try {
    body = await request.json();
  } catch {
    return bad(400, 'Ungültiges JSON');
  }

  let data;
  try {
    data = {
      vorname: requireString(body, 'vorname', { max: 100 }),
      nachname: requireString(body, 'nachname', { max: 100 }),
      strasse: requireString(body, 'strasse', { max: 200 }),
      plz: requireString(body, 'plz', { max: 10 }),
      ort: requireString(body, 'ort', { max: 100 }),
      land: (body.land || 'Deutschland').trim().slice(0, 60),
      email: requireString(body, 'email', { max: 200 }),
      iban: normalizeIban(body.iban || ''),
      bic: (body.bic || '').trim().toUpperCase().slice(0, 11),
      betrag: Number(body.betrag),
      rhythmus: String(body.rhythmus || '').trim(),
      startdatum: requireString(body, 'startdatum', { max: 20 }),
      bestaetigung: body.bestaetigung === true
    };
  } catch (e) {
    return bad(400, e.message);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return bad(400, 'Ungültige E-Mail-Adresse');
  const ibanCheck = validateIban(data.iban);
  if (!ibanCheck.ok) {
    const IBAN_REASONS = {
      format: 'ungültiges Format',
      country_not_sepa: 'Land nicht Teil des SEPA-Raums',
      length: 'falsche Länge',
      checksum: 'Prüfziffer stimmt nicht'
    };
    const reasonDe = IBAN_REASONS[ibanCheck.reason] || 'ungültig';
    return bad(400, `IBAN ungültig (${reasonDe})`);
  }
  if (!(data.betrag > 0) || data.betrag > 100000) return bad(400, 'Betrag ungültig');
  if (!RHYTHM.has(data.rhythmus)) return bad(400, 'Rhythmus ungültig');
  if (!isValidIsoDate(data.startdatum)) return bad(400, 'Erstes Belastungsdatum ungültig');
  const earliest = berlinIsoDate(MIN_LEAD_DAYS_SUBMIT);
  if (data.startdatum < earliest) {
    return bad(400, `Das erste Belastungsdatum muss mindestens ${MIN_LEAD_DAYS_SUBMIT} Tage in der Zukunft liegen (frühestens ${germanDate(earliest)}).`);
  }
  if (!data.bestaetigung) return bad(400, 'Bestätigung der Ermächtigung fehlt');

  const mandatsref = generateMandateRef();
  const token = crypto.randomUUID().replace(/-/g, '');
  const submittedAt = new Date().toISOString();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';

  const record = {
    status: 'pending',
    data,
    mandatsref,
    submittedAt,
    submittedIp: ip,
    submittedUserAgent: userAgent
  };

  if (env.SEPA_MANDATES) {
    // 48h Gültigkeit für den Bestätigungslink
    await env.SEPA_MANDATES.put(`token:${token}`, JSON.stringify(record), { expirationTtl: 60 * 60 * 48 });
  }

  const siteUrl = env.SITE_URL || 'https://zentrumgrundrechte.de';
  const confirmUrl = `${siteUrl}/api/sepa/confirm?t=${token}`;

  await sendMail(env, {
    to: data.email,
    subject: 'Bitte bestätigen: SEPA-Lastschriftmandat für das Zentrum Grundrechte',
    html: renderConfirmEmail({ data, mandatsref, confirmUrl })
  });

  return new Response(JSON.stringify({ ok: true, mandatsref }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function renderConfirmEmail({ data, mandatsref, confirmUrl }) {
  const name = `${data.vorname} ${data.nachname}`;
  return `<!doctype html><html><body style="font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;color:#3A332F;max-width:560px;margin:0 auto;padding:24px;line-height:1.55;">
<p>Liebe/r ${name},</p>
<p>vielen Dank für Ihre Unterstützung des Zentrums Grundrechte. Bitte bestätigen Sie Ihr SEPA-Lastschriftmandat über den folgenden Link — erst danach wird das Mandat gültig und wir können die Lastschrift einziehen.</p>
<p style="margin:28px 0;"><a href="${confirmUrl}" style="display:inline-block;background:#FF2D2D;color:#fff;padding:12px 20px;text-decoration:none;font-weight:700;letter-spacing:-0.01em;">Mandat jetzt bestätigen</a></p>
<p style="font-size:13px;color:#888;">Mandatsreferenz: ${mandatsref}<br>Der Link ist 48 Stunden gültig.</p>
<p style="font-size:13px;color:#888;">Falls Sie dieses Mandat nicht angefordert haben, ignorieren Sie diese E-Mail bitte — es wird nichts eingezogen.</p>
<hr style="border:none;border-top:1px solid #E0E0DC;margin:28px 0;">
<p style="font-size:12px;color:#888;">Zentrum Grundrechte e.V. · Hauptstraße 2b · 13158 Berlin · kontakt@zentrumgrundrechte.de</p>
</body></html>`;
}
