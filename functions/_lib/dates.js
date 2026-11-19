// Datums-Helfer für das SEPA-Backend (Kalenderdatum in Berlin).
// Gleiche Logik wie im Pre-Notification-Worker (workers/pre-notification).

// Mindestvorlauf zwischen heute und erstem Belastungsdatum:
// - beim Absenden des Formulars (lässt einen Tag Puffer für die Bestätigung)
export const MIN_LEAD_DAYS_SUBMIT = 3;
// - beim Klick auf den Bestätigungslink: Der Cron (täglich 08:00 Berlin)
//   muss die Vorabankündigung noch am Vortag verschicken können.
export const MIN_LEAD_DAYS_CONFIRM = 2;

const BERLIN_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
});

// "YYYY-MM-DD" in Berlin, optional um n Tage verschoben
export function berlinIsoDate(offsetDays = 0, now = new Date()) {
  const [y, m, d] = BERLIN_DATE.format(now).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return t.toISOString().slice(0, 10);
}

// Prüft, ob "YYYY-MM-DD" ein echtes Kalenderdatum ist (kein 30.02.)
export function isValidIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

// "YYYY-MM-DD" → "DD.MM.YYYY"
export function germanDate(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}.${m}.${y}`;
}

// ISO-Zeitstempel → "DD.MM.YYYY, HH:MM Uhr" in Berliner Zeit
const BERLIN_DATETIME = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit'
});
export function germanDateTime(isoTimestamp) {
  const d = new Date(isoTimestamp);
  if (isNaN(d)) return String(isoTimestamp);
  return BERLIN_DATETIME.format(d) + ' Uhr';
}
