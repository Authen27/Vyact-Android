// Vyact (Android sideload build) — JS side of the native SmsBridge plugin.
//
// The plugin exists only in the SMS sideload build (MainActivity registers it by name if present), so
// on the web, in the Play build, and anywhere the manifest lacks RECEIVE_SMS every call here resolves
// to "not available" and the Settings card never renders. Nothing in this file reads a message: the
// native receiver keeps detected ones on the phone, and one is read here only when its notification
// is tapped.

import { registerPlugin } from '@capacitor/core';
import { isNative } from '../native';

export interface SmsState {
  /** The build declares RECEIVE_SMS (the sideload build). */
  declared: boolean;
  /** Android has granted it. */
  granted: boolean;
  /** The in-app switch. */
  enabled: boolean;
  /** Android lets the app post notifications (the prompt IS a notification). */
  notificationsOn: boolean;
  /** Detected messages still waiting to be opened or ignored. */
  pending: number;
}

export interface PendingSms {
  id: string;
  sender: string;
  body: string;
  ts: number;
  dir: 'debit' | 'credit';
  amount: string;
  cur: string;
  cp: string;
}

interface SmsBridgePlugin {
  getState(): Promise<SmsState>;
  requestPermission(): Promise<SmsState>;
  setEnabled(opts: { enabled: boolean }): Promise<SmsState>;
  drain(): Promise<{ items: PendingSms[] }>;
  markHandled(opts: { id: string }): Promise<void>;
}

const Sms = registerPlugin<SmsBridgePlugin>('SmsBridge');

/** The plugin's state, or null when this build has no SMS support. */
export async function smsState(): Promise<SmsState | null> {
  if (!isNative()) return null;
  try {
    const s = await Sms.getState();
    return s.declared ? s : null;
  } catch {
    return null; // "SmsBridge plugin is not implemented on android" — a build without it
  }
}

export async function requestSmsPermission(): Promise<SmsState | null> {
  try { return await Sms.requestPermission(); } catch { return null; }
}

export async function setSmsEnabled(enabled: boolean): Promise<SmsState | null> {
  try { return await Sms.setEnabled({ enabled }); } catch { return null; }
}

export async function pendingSms(id: string): Promise<PendingSms | null> {
  try {
    const { items } = await Sms.drain();
    return items.find(i => i.id === id) ?? null;
  } catch {
    return null;
  }
}

export async function markSmsHandled(id: string): Promise<void> {
  try { await Sms.markHandled({ id }); } catch { /* the entry expires on its own after 7 days */ }
}
