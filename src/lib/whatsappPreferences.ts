// v10.42.0 (W2) — the signed-in person's WhatsApp message preferences.
// Server-owned table; read and changed only through the two RPCs, which act on
// auth.uid() and nothing else (supabase/migrations/20260926120000_…).
import { sb } from './supabase';

export interface WhatsAppPreferences {
  marketing_opt_in: boolean;
  marketing_opt_in_at: string | null;
  insights_opt_in: boolean;
  /** v10.45.0 — answer questions on WhatsApp (figures appear on the phone). */
  reads_enabled: boolean;
  muted_topics: string[];
  large_txn_threshold: number;
  linked: boolean;
}

export interface WhatsAppPreferencesPatch {
  marketingOptIn?: boolean;
  /** v10.47.0 — payday, evening digest and month close: insights about your own money. */
  insightsOptIn?: boolean;
  mutedTopics?: string[];
  largeTxnThreshold?: number;
  readsEnabled?: boolean;
}

function parse(data: unknown): WhatsAppPreferences {
  const d = (data ?? {}) as Partial<WhatsAppPreferences>;
  return {
    marketing_opt_in: !!d.marketing_opt_in,
    marketing_opt_in_at: d.marketing_opt_in_at ?? null,
    insights_opt_in: !!d.insights_opt_in,
    reads_enabled: !!d.reads_enabled,
    muted_topics: Array.isArray(d.muted_topics) ? d.muted_topics : [],
    large_txn_threshold: Number(d.large_txn_threshold ?? 10000),
    linked: !!d.linked,
  };
}

export async function readWhatsAppPreferences(): Promise<WhatsAppPreferences> {
  const { data, error } = await sb().rpc('get_my_whatsapp_preferences');
  if (error) throw new Error(error.message);
  return parse(data);
}

export async function saveWhatsAppPreferences(patch: WhatsAppPreferencesPatch): Promise<WhatsAppPreferences> {
  const { data, error } = await sb().rpc('set_my_whatsapp_preferences', {
    p_marketing_opt_in: patch.marketingOptIn ?? null,
    p_insights_opt_in: patch.insightsOptIn ?? null,
    p_muted_topics: patch.mutedTopics ?? null,
    p_large_txn_threshold: patch.largeTxnThreshold ?? null,
    p_reads_enabled: patch.readsEnabled ?? null,
  });
  if (error) throw new Error(error.message);
  return parse(data);
}
