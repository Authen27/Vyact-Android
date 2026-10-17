// Vyact on WhatsApp — the business number people chat with (v10.54.0).
// One place for it: the connect drawer's "Open WhatsApp" button and any future
// deep link read it from here.

/** Vyact's WhatsApp Business number, digits only with country code (+91 88978 82803). */
export const WHATSAPP_BUSINESS_NUMBER = '918897882803';

/** A wa.me link that opens a chat with Vyact, optionally with a first message typed in. */
export function whatsappChatLink(text?: string): string {
  return `https://wa.me/${WHATSAPP_BUSINESS_NUMBER}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
