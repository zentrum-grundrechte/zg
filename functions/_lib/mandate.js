// Mandatstext und Mandatsreferenz-Generator.

const GLAEUBIGER_ID = 'DE04ZZZ00002950443';
const ORG_NAME = 'Zentrum Grundrechte e.V.';
const ORG_STREET = 'Hauptstraße 2b';
const ORG_CITY = '13158 Berlin';

// Mandatsreferenz-Format: ZG-JJJJ-NNNNNN
// Hier noch zufällig; wenn später eine KV/D1 angebunden ist, wird
// NNNNNN fortlaufend. Für den MVP (manuelle Verarbeitung) reicht
// die Eindeutigkeit per Zufallsanteil.
export function generateMandateRef(now = new Date()) {
  const year = now.getFullYear();
  const rand = Array.from(crypto.getRandomValues(new Uint32Array(1)))[0];
  const num = String(rand % 1_000_000).padStart(6, '0');
  return `ZG-${year}-${num}`;
}

const RHYTHM_LABEL = {
  einmalig: 'einmalig',
  monatlich: 'monatlich',
  vierteljaehrlich: 'vierteljährlich',
  jaehrlich: 'jährlich'
};

export function renderMandateHtml(data, meta) {
  const {
    vorname, nachname, strasse, plz, ort, land = 'Deutschland',
    email, iban, bic = '', betrag, rhythmus, startdatum,
    mandatsref
  } = data;
  const { confirmedAt, ip, userAgent } = meta;
  const name = `${vorname} ${nachname}`;
  const anschrift = `${strasse}, ${plz} ${ort}, ${land}`;
  const betragFmt = Number(betrag).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const rhythmusFmt = RHYTHM_LABEL[rhythmus] || rhythmus;

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>SEPA-Lastschriftmandat ${mandatsref}</title>
<style>
  body { font-family: -apple-system, 'Inter', 'Helvetica Neue', Arial, sans-serif; color:#3A332F; max-width:720px; margin:40px auto; padding:0 24px; line-height:1.55; }
  h1 { font-size:22px; letter-spacing:-0.01em; margin:0 0 24px; border-bottom:2px solid #FF2D2D; padding-bottom:10px; }
  h2 { font-size:14px; letter-spacing:0.08em; text-transform:uppercase; color:#888; margin:28px 0 8px; }
  dl { margin:0; }
  dt { color:#888; font-size:13px; }
  dd { margin:0 0 10px; font-weight:600; font-size:15px; }
  .box { border:1.5px solid #E0E0DC; padding:16px 20px; margin:16px 0; background:#FAFAF8; font-size:14px; }
  .audit { font-size:12px; color:#888; border-top:1px solid #E0E0DC; padding-top:16px; margin-top:32px; }
  .ref { display:inline-block; background:#3A332F; color:#fff; padding:4px 10px; font-family: 'SF Mono', Menlo, monospace; font-size:13px; letter-spacing:0.05em; }
</style>
</head><body>

<h1>SEPA-Lastschriftmandat</h1>

<p><strong>Mandatsreferenz:</strong> <span class="ref">${mandatsref}</span></p>

<h2>Zahlungsempfänger (Gläubiger)</h2>
<div class="box">
  <strong>${ORG_NAME}</strong><br>
  ${ORG_STREET}<br>
  ${ORG_CITY}<br>
  Gläubiger-ID: <code>${GLAEUBIGER_ID}</code>
</div>

<h2>Ermächtigung</h2>
<p>Ich ermächtige das ${ORG_NAME}, Zahlungen von meinem Konto mittels Lastschrift einzuziehen. Zugleich weise ich mein Kreditinstitut an, die vom ${ORG_NAME} auf mein Konto gezogenen Lastschriften einzulösen.</p>
<p><em>Hinweis:</em> Ich kann innerhalb von acht Wochen, beginnend mit dem Belastungsdatum, die Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit meinem Kreditinstitut vereinbarten Bedingungen.</p>
<p><em>Verkürzte Vorabankündigung:</em> Die Pre-Notification über Fälligkeit und Betrag der Lastschrift erfolgt spätestens einen Tag vor dem Belastungsdatum, abweichend von der 14-Tage-Regel.</p>

<h2>Zahlungspflichtige/r</h2>
<dl>
  <dt>Name</dt><dd>${name}</dd>
  <dt>Anschrift</dt><dd>${anschrift}</dd>
  <dt>E-Mail</dt><dd>${email}</dd>
  <dt>IBAN</dt><dd><code>${iban.match(/.{1,4}/g).join(' ')}</code></dd>
  ${bic ? `<dt>BIC</dt><dd><code>${bic}</code></dd>` : ''}
</dl>

<h2>Lastschrift</h2>
<dl>
  <dt>Betrag</dt><dd>${betragFmt}</dd>
  <dt>Rhythmus</dt><dd>${rhythmusFmt}</dd>
  <dt>Erstes Belastungsdatum</dt><dd>${startdatum}</dd>
  <dt>Verwendungszweck</dt><dd>Spende an ${ORG_NAME}</dd>
</dl>

<div class="audit">
  <strong>Elektronische Erteilung (einfache elektronische Signatur, Art. 3 Nr. 10 eIDAS-VO)</strong><br>
  Dieses Mandat wurde am <strong>${confirmedAt}</strong> über zentrumgrundrechte.de elektronisch erteilt und per Bestätigungsklick auf einen an die oben genannte E-Mail-Adresse gesendeten Verifizierungslink finalisiert.<br>
  Bestätigungs-IP: <code>${ip}</code> · User-Agent: <code>${userAgent}</code>
</div>

</body></html>`;
}

export const ORG = { name: ORG_NAME, street: ORG_STREET, city: ORG_CITY, glaeubigerId: GLAEUBIGER_ID };
