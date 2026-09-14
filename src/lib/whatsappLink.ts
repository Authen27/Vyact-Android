import { sb } from './supabase';

export interface WhatsAppLinkStatus {
  status: 'linked' | 'unlinked';
  phone?: string;
  householdId?: string;
}

export async function readWhatsAppLink(action: 'status' | 'unlink' = 'status'): Promise<WhatsAppLinkStatus> {
  const { data, error } = await sb().functions.invoke('whatsapp-verify-otp', { body: { action } });
  if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'WhatsApp request failed');
  if (data?.status !== 'linked' && data?.status !== 'unlinked') throw new Error('Invalid WhatsApp link status');
  return data as WhatsAppLinkStatus;
}