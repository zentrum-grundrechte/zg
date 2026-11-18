// Brevo-Client als dünner Fetch-Wrapper.
// Env: BREVO_API_KEY, FROM_EMAIL (z.B. "Zentrum Grundrechte <kontakt@zentrumgrundrechte.de>")

// "Name <mail@domain>" → { name, email }; nackte Mail → { email }
function parseAddress(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, ''), email: m[2] };
  return { email: s };
}

export async function sendMail(env, { to, subject, html, replyTo }) {
  if (!env.BREVO_API_KEY) throw new Error('BREVO_API_KEY fehlt');
  const fromRaw = env.FROM_EMAIL || 'Zentrum Grundrechte <kontakt@zentrumgrundrechte.de>';
  const sender = parseAddress(fromRaw);
  const recipients = (Array.isArray(to) ? to : [to]).map(x =>
    typeof x === 'string' ? { email: x } : x
  );
  const body = {
    sender,
    to: recipients,
    subject,
    htmlContent: html,
    // Brevo-Click-/Open-Tracking per Request abschalten. Transaktionale
    // Mandats-Mails sollen direkt auf zentrumgrundrechte.de zeigen und
    // keine Tracking-Pixel enthalten (DSGVO + Spender-Vertrauen).
    headers: {
      'X-Mailin-Tag': 'transactional-no-tracking',
      'X-Mailin-Custom': 'no-tracking',
      'X-sib-trackclicks': '0',
      'X-sib-trackopens': '0',
      'X-Mailin-TrackOpen': '0',
      'X-Mailin-TrackClick': '0'
    },
    ...(replyTo ? { replyTo: parseAddress(replyTo) } : {})
  };
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
    const text = await res.text();
    throw new Error(`Brevo ${res.status}: ${text}`);
  }
  return res.json();
}
