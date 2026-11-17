// GET /api/sepa/confirm?t=<token>
// Bestätigt ein pending Mandat, generiert das finale HTML-Mandat,
// schickt Kopien an Spender + Verein, markiert Mandat als confirmed.

import { sendMail } from '../../_lib/email.js';
import { renderMandateHtml } from '../../_lib/mandate.js';

function htmlPage(title, body) {
  return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,'Inter','Helvetica Neue',Arial,sans-serif;color:#3A332F;max-width:560px;margin:80px auto;padding:0 24px;line-height:1.55;}
h1{font-size:28px;letter-spacing:-0.01em;margin:0 0 20px;}
a{color:#FF2D2D;font-weight:700;}
.box{border:1.5px solid #E0E0DC;padding:20px 24px;background:#FAFAF8;margin:24px 0;}
</style></head><body>${body}<p style="font-size:12px;color:#888;margin-top:40px;">Zentrum Grundrechte e.V. · <a href="/">zurück zur Startseite</a></p></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    return htmlPage('Ungültiger Link', '<h1>Ungültiger Bestätigungslink</h1><p>Dieser Link ist leider nicht gültig. Falls Sie das Mandat gerade eingereicht haben, prüfen Sie bitte den Link in der Bestätigungsmail.</p>');
  }

  if (!env.SEPA_MANDATES) {
    return htmlPage('Serverfehler', '<h1>Serverfehler</h1><p>Die Mandats-Datenbank ist nicht angebunden. Bitte melden Sie sich kurz bei <a href="mailto:kontakt@zentrumgrundrechte.de">kontakt@zentrumgrundrechte.de</a>.</p>');
  }

  const raw = await env.SEPA_MANDATES.get(`token:${token}`);
  if (!raw) {
    return htmlPage('Link abgelaufen', '<h1>Dieser Link ist abgelaufen oder bereits bestätigt</h1><p>Falls das Mandat noch nicht aktiv ist, reichen Sie es bitte neu auf der <a href="/?view=unterstuetzen">Unterstützen-Seite</a> ein.</p>');
  }

  const record = JSON.parse(raw);
  if (record.status === 'confirmed') {
    return htmlPage('Bereits bestätigt', `<h1>Mandat bereits bestätigt</h1><p>Mandatsreferenz: <strong>${record.mandatsref}</strong></p><p>Vielen Dank für Ihre Unterstützung.</p>`);
  }

  const confirmedAt = new Date().toISOString();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';

  record.status = 'confirmed';
  record.confirmedAt = confirmedAt;
  record.confirmedIp = ip;
  record.confirmedUserAgent = userAgent;

  // Mandat im Langzeit-Store ablegen (ohne TTL)
  await env.SEPA_MANDATES.put(`mandate:${record.mandatsref}`, JSON.stringify(record));
  // Token verbrauchen
  await env.SEPA_MANDATES.delete(`token:${token}`);

  const mandateHtml = renderMandateHtml(
    { ...record.data, mandatsref: record.mandatsref },
    { confirmedAt, ip, userAgent }
  );

  const adminEmail = env.ADMIN_EMAIL || 'kontakt@zentrumgrundrechte.de';

  // Mandat an Verein (zur Verarbeitung in FYRST) + an Spender (als Beleg)
  await Promise.all([
    sendMail(env, {
      to: adminEmail,
      subject: `Neues SEPA-Mandat: ${record.mandatsref} · ${record.data.vorname} ${record.data.nachname}`,
      html: mandateHtml
    }),
    sendMail(env, {
      to: record.data.email,
      subject: `Ihr SEPA-Lastschriftmandat (${record.mandatsref})`,
      html: mandateHtml
    })
  ]);

  return htmlPage('Bestätigt', `<h1>Danke — Mandat bestätigt</h1>
<div class="box">
<p>Mandatsreferenz: <strong>${record.mandatsref}</strong></p>
<p>Wir haben Ihnen eine Kopie des Mandats per E-Mail geschickt. Die erste Lastschrift wird frühestens am <strong>${record.data.startdatum}</strong> eingezogen.</p>
</div>
<p>Vielen Dank, dass Sie die Arbeit des Zentrums Grundrechte unterstützen.</p>`);
}
