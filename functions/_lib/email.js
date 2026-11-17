// Resend-Client als dünner Fetch-Wrapper.
// Env: RESEND_API_KEY, FROM_EMAIL (z.B. "Zentrum Grundrechte <kontakt@zentrumgrundrechte.de>")

export async function sendMail(env, { to, subject, html, replyTo }) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY fehlt');
  const from = env.FROM_EMAIL || 'Zentrum Grundrechte <kontakt@zentrumgrundrechte.de>';
  const body = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    ...(replyTo ? { reply_to: replyTo } : {})
  };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  return res.json();
}
