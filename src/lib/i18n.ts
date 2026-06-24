import { LOCALES } from '../constants';

export function t(key: string, lang = 'en'): string {
  return LOCALES[lang]?.strings?.[key] ?? LOCALES.en.strings[key] ?? key;
}
