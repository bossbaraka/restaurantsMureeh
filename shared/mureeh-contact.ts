/** The sole public contact channel for Mureeh sales and platform support. */
export const MUREEH_WHATSAPP_NUMBER = '970593498909';
export const MUREEH_WHATSAPP_DISPLAY = '+970593498909';

/** Build a direct WhatsApp chat link without exposing any other contact route. */
export function buildMureehWhatsAppUrl(message?: string): string {
  const baseUrl = `https://wa.me/${MUREEH_WHATSAPP_NUMBER}`;
  const trimmedMessage = message?.trim();
  return trimmedMessage ? `${baseUrl}?text=${encodeURIComponent(trimmedMessage)}` : baseUrl;
}
