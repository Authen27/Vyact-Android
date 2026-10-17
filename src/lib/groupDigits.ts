// Aurora 4.0 ON1 — onboarding amounts are grouped as you type ("1,45,000", "28,000"), as everywhere
// else in the app shows them. Commas only, never the currency's own locale: a German or Indonesian
// locale writes "1.450" for one thousand four hundred and fifty, which would read back as 1.45.
// INR groups in lakhs (2-2-3); every other currency in thousands (3-3-3).

/** Keep digits and one decimal point (two places), then group the whole part with commas. */
export function groupDigits(raw: string, currency: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  const whole = (dot === -1 ? cleaned : cleaned.slice(0, dot)).replace(/^0+(?=\d)/, '');
  const fraction = dot === -1 ? null : cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  let grouped: string;
  if (currency === 'INR' && whole.length > 3) {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  } else {
    grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  return fraction === null ? grouped : `${grouped || '0'}.${fraction}`;
}

/** The number a grouped field holds (0 when empty). */
export function groupedValue(text: string): number {
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
