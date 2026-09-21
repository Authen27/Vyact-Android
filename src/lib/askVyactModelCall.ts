// Ask Vyact — model transport (architecture P3).
//
// The ONE place the app talks to a model. Everything else takes a `ModelCall`
// function, so the assistant, its tests and the eval harness are all provider-
// agnostic and run offline.
//
// 🔴 THE MODEL IS NEVER CALLED FROM THE BROWSER DIRECTLY.
// Requests go to the `ask-vyact` Edge Function, which holds the provider key in
// Supabase secrets. A browser-side key would ship in the bundle and be readable
// by anyone who opens devtools — that is exactly the mistake the retired
// geminiBackend made, and the reason the key is server-side now.
//
// Returns null when nothing is configured. Null means UNAVAILABLE; it must never
// be interpreted as permission to answer from somewhere else.

import { supabase } from './supabase';
import type { ModelCall } from './askVyactLlm';

/** Shape the `ask-vyact` gateway returns. `enabled:false` is a normal, expected
 *  state — the kill switch is a DB row, and off is the default. */
interface GatewayResponse {
  ok: boolean;
  enabled?: boolean;
  text?: string;
  error?: string;
  message?: string;
  /** v10.37 Claude Code relay (test-only): the queued call to poll. */
  relayId?: string;
}

/** Relay polling cadence and budget (v10.37, TEST-ONLY — TD-44). */
export const RELAY_POLL_INTERVAL_MS = 3_000;
export const RELAY_POLL_BUDGET_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Build the transport, or null when the app has no cloud backend at all
 * (localStorage-only mode has no Edge Function to call).
 */
export function resolveConfiguredModelCall(): ModelCall | null {
  const client = supabase;
  if (!client) return null;

  return async ({ system, user, json, maxTokens }) => {
    const { data, error } = await client.functions.invoke<GatewayResponse>('ask-vyact', {
      body: {
        seam: 'assistant',
        surface: 'chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        ...(json ? { responseFormat: 'json' } : {}),
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      },
    });

    // Transport failure — the caller turns this into an "unavailable" turn.
    if (error) throw new Error(error.message ?? 'gateway request failed');
    if (!data) throw new Error('empty gateway response');

    // v10.37 Claude Code relay (TEST-ONLY, allowlisted accounts): the gateway queued
    // the call instead of answering. Poll until the relay session writes the reply.
    if (data.error === 'relay_pending' && data.relayId) {
      const relayId = data.relayId;
      const deadline = Date.now() + RELAY_POLL_BUDGET_MS;
      while (Date.now() < deadline) {
        await sleep(RELAY_POLL_INTERVAL_MS);
        const polled = await client.functions.invoke<GatewayResponse>('ask-vyact', {
          body: { seam: 'assistant', relayPoll: relayId },
        });
        if (polled.error) throw new Error(polled.error.message ?? 'relay poll failed');
        if (!polled.data) throw new Error('empty relay poll response');
        if (polled.data.error === 'relay_pending') continue;
        if (!polled.data.ok) throw new Error(polled.data.message ?? polled.data.error ?? 'relay error');
        if (!polled.data.text) throw new Error('relay returned no text');
        return polled.data.text;
      }
      throw new Error('relay did not answer in time');
    }

    // The kill switch is off, or no model row is enabled. This is a normal
    // configuration state, not a bug, and it must surface as unavailable rather
    // than as a silent empty answer.
    if (data.enabled === false) {
      throw new Error(data.message ?? 'no model is enabled for the assistant');
    }
    if (!data.ok) throw new Error(data.message ?? data.error ?? 'gateway error');
    if (!data.text) throw new Error('model returned no text');

    return data.text;
  };
}
