// W7a (audit FE-UIS-15) — the page's `<html lang>` follows the Language setting, so a screen reader
// pronounces the interface in the right voice. The setting's keys are already BCP-47 codes; anything
// unknown falls back to English, the language the page ships in.
import { LOCALES } from '../constants';

export function htmlLangFor(language: string | undefined): string {
  return language && Object.prototype.hasOwnProperty.call(LOCALES, language) ? language : 'en';
}
