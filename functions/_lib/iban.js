// IBAN-Validierung nach ISO 13616 (Mod-97-Prüfung).
// Unterstützt alle SEPA-Länder; prüft Format + Prüfziffer.

const IBAN_LENGTHS = {
  DE: 22, AT: 20, CH: 21, LI: 21, LU: 20, BE: 16, NL: 18, FR: 27,
  IT: 27, ES: 24, PT: 25, FI: 18, SE: 24, DK: 18, NO: 15, IE: 22,
  GB: 22, PL: 28, CZ: 24, SK: 24, HU: 28, HR: 21, SI: 19, EE: 20,
  LV: 21, LT: 20, BG: 22, RO: 24, GR: 27, CY: 28, MT: 31, IS: 26,
  MC: 27, SM: 27, AD: 24, VA: 22
};

export function normalizeIban(raw) {
  return String(raw || '').replace(/\s+/g, '').toUpperCase();
}

export function validateIban(raw) {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) {
    return { ok: false, reason: 'format' };
  }
  const country = iban.slice(0, 2);
  const expectedLen = IBAN_LENGTHS[country];
  if (!expectedLen) return { ok: false, reason: 'country_not_sepa' };
  if (iban.length !== expectedLen) return { ok: false, reason: 'length' };

  // Mod-97: move first 4 chars to end, replace letters A=10..Z=35, mod 97 === 1
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let numeric = '';
  for (const ch of rearranged) {
    numeric += /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
  }
  // Big-number mod 97 in chunks
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = parseInt(String(remainder) + numeric.slice(i, i + 7), 10) % 97;
  }
  return remainder === 1
    ? { ok: true, country, iban }
    : { ok: false, reason: 'checksum' };
}

export function formatIban(iban) {
  return normalizeIban(iban).match(/.{1,4}/g)?.join(' ') || iban;
}
