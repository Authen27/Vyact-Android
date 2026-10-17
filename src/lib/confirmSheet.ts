// Aurora 4.0 G4 (X6, CF2, MD1) — the app's confirmation sheet, replacing window.confirm/prompt.
//
// A call site awaits `confirmSheet({...})` (true / false) or `askSheet({...})` (with an input or a
// choice) exactly where it used to call confirm()/prompt(). The request is held in this small store
// and rendered once by <ConfirmHost/> (App.tsx): a half-sheet on phones, a 460px centred dialog on
// desktop. Anatomy (CF2): the title is a question naming the item, 1–3 lines say what happens (and
// what stays), one action named after the verb, and Cancel.
//
// CF1: only actions that lose data or affect other people ask. Reversible ones act at once and offer
// Undo in the toast (lib/undoable.ts).
import { create } from 'zustand';

export interface ConfirmChoice {
  value: string;
  label: string;
  detail?: string;
  recommended?: boolean;
  /** The action button's label while this choice is selected. */
  action: string;
  tone?: 'danger' | 'primary';
}

export interface ConfirmInput {
  label: string;
  initial?: string;
  placeholder?: string;
  /** Empty is allowed (an optional note). */
  optional?: boolean;
  /** Type-to-confirm: the action is enabled only when the value equals this (CF15). */
  mustEqual?: string;
  /** A 6-digit numeric code (CF17). */
  code?: boolean;
  maxLength?: number;
}

export interface ConfirmRequest {
  /** A question that names the item: "Delete Swiggy, ₹486?" */
  title: string;
  /** 1–3 short lines: what happens, and what stays. */
  lines?: string[];
  /** A quiet line under the body (a softer alternative, a resend hint). */
  note?: string;
  /** The action, named after the verb: "Delete entry". */
  action: string;
  /** danger (red, the default) for destructive actions; primary (accent) for the rest. */
  tone?: 'danger' | 'primary';
  cancel?: string;
  input?: ConfirmInput;
  choices?: ConfirmChoice[];
  /** CF17 — "Resend" after a countdown. */
  resend?: { seconds: number; run: () => Promise<unknown> | void };
}

export interface ConfirmResult {
  ok: boolean;
  /** The input's value (trimmed), or '' when there is none. */
  value: string;
  /** The selected choice's value, when the request has choices. */
  choice?: string;
}

interface PendingRequest extends ConfirmRequest {
  id: number;
  resolve: (result: ConfirmResult) => void;
}

interface ConfirmState {
  current: PendingRequest | null;
}

export const useConfirmStore = create<ConfirmState>(() => ({ current: null }));

let seq = 0;
const CANCELLED: ConfirmResult = { ok: false, value: '' };

/** Opens the sheet and resolves with the person's answer. A second request cancels the first. */
export function askSheet(request: ConfirmRequest): Promise<ConfirmResult> {
  const previous = useConfirmStore.getState().current;
  if (previous) previous.resolve(CANCELLED);
  return new Promise(resolve => {
    const id = ++seq;
    useConfirmStore.setState({
      current: {
        ...request,
        id,
        resolve: result => {
          // Close only if this request is still the one showing.
          if (useConfirmStore.getState().current?.id === id) useConfirmStore.setState({ current: null });
          resolve(result);
        },
      },
    });
  });
}

/** true when the person chose the action; false on Cancel, Escape or tapping outside. */
export async function confirmSheet(request: ConfirmRequest): Promise<boolean> {
  return (await askSheet(request)).ok;
}

/** Whether the request's action may run with this input value (pure — tested). */
export function inputAccepts(input: ConfirmInput | undefined, value: string): boolean {
  if (!input) return true;
  const v = value.trim();
  if (input.code) return /^\d{6}$/.test(v);
  if (input.mustEqual !== undefined) return v === input.mustEqual.trim();
  return input.optional ? true : v.length > 0;
}
