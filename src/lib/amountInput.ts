// W8a (audit FE-UIC-10) — one reader for typed money amounts. Amount fields used to strip every comma,
// so a decimal-comma user's "12,50" was saved as 1250. The rule:
//   • a single comma followed by one or two final digits, with no dot, is the decimal mark: "12,50" → 12.5;
//   • any other comma is digit grouping: "1,50,000" → 150000, "150,000" → 150000, "1,234.56" → 1234.56.
// Returns NaN for text that is not an amount (callers already treat NaN / ≤ 0 as "enter an amount").

export function parseAmount(raw: string | null | undefined): number {
  let s = String(raw ?? '').replace(/\s+/g, '');
  if (!s) return NaN;
  const commas = (s.match(/,/g) ?? []).length;
  if (commas === 1 && !s.includes('.') && /,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Math.round(Number(s) * 100) / 100;
}
