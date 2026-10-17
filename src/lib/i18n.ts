import { LOCALES } from '../constants';

export function t(key: string, lang = 'en'): string {
  return LOCALES[lang]?.strings?.[key] ?? LOCALES.en.strings[key] ?? key;
}

/** W8a (audit FE-UIS-15, owner: keep all six, label them) — only English is complete; the others
 *  translate the navigation and little else, so the Language select says so instead of promising a
 *  translated app. */
export const FULLY_TRANSLATED = new Set(['en']);
export function languageOptionLabel(code: string): string {
  const name = LOCALES[code]?.name ?? code;
  return FULLY_TRANSLATED.has(code) ? name : `${name} — Preview: navigation only`;
}
