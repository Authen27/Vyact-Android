import { useState, useRef, useEffect, useMemo } from 'react';
import {
  MessageCircle, Mic, List, ArrowUpRight, ArrowUp, Square, Plus, Copy, Check, ThumbsUp, ThumbsDown, RotateCcw, BookOpen,
} from 'lucide-react';
import { useStore } from '../store';
import { Panel } from '../components/ui/Card';
import Button from '../components/ui/Button';
import {
  buildSafeSummary, type ChatMessage,
} from '../lib/aiSummary';
import type { AssistantChip } from '../lib/askVyactResponses';
import { logAiUsage, classifyIntent, createTurnTimer } from '../lib/aiUsage';
import { saveFeedback } from '../lib/aiFeedback';
import { track } from '../lib/analytics';
import { isCloudEnabled } from '../lib/supabase';
import { useCategoryClassifications } from '../lib/categorization';
import WhatsAppIcon from '../components/whatsapp/WhatsAppIcon';
import WhatsAppConnectSheet from '../components/whatsapp/WhatsAppConnectSheet';
import ls from '../lib/localStorageCompat';
import { appNavigate } from '../lib/appNavigation';
import {
  BUCKET_LABEL, intentsByBucket, intentExample, type Bucket, type Intent,
} from '../lib/askVyactIntents';
import { can } from '../lib/permissions';
import { isAskVyactEnabled, FEATURES } from '../config/features';
import {
  runAssistant, proactiveInsight, selectModelCall, LlmBackend, type AssistantContext,
} from '../lib/askVyactBackend';
import PageHead from '../components/ui/PageHead';
import CaptureCard from '../components/chat/CaptureCard';
import type { Transaction } from '../types';

/** A transcript row, plus what A7 keeps per turn on this device: the entry Pip understood (PIP2) and
 *  a failed turn's question (PIP1). Kept local so the shared ChatMessage type is untouched. */
type ChatRow = ChatMessage & {
  capture?: { seed: Partial<Transaction>; saved?: boolean };
  failedQuestion?: string;
};

/** Aurora 4.0 P2 / PIP3 — the standard raised chip (the examples and the follow-ups look alike). */
const CHIP_CLASS = 'inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[40px] px-3.5 rounded-pill text-[13px] font-medium max-w-full transition-[box-shadow,color] disabled:opacity-50 disabled:cursor-not-allowed';
const CHIP_STYLE = { background: 'var(--canvas)', color: 'hsl(var(--ink))', boxShadow: 'var(--neu-sm)' } as const;

// Minimal Web Speech API shapes (lib.dom doesn't ship these in all TS configs).
interface SpeechRecognitionEventLike {
  results: { [i: number]: { [j: number]: { transcript: string }; isFinal?: boolean } };
  resultIndex: number;
}
interface SpeechRecognitionErrorLike { error: string; }
interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: (e: SpeechRecognitionEventLike) => void;
  onerror: (e: SpeechRecognitionErrorLike) => void;
  onend: () => void;
  start: () => void; stop: () => void;
}

// 'setup' is not here: those intents open forms and render as their own row.
const BUCKETS: Bucket[] = ['capture', 'inquire', 'plan'];

// Both backends are resolved PER TURN inside `send()`, never memoised here.
// Module-scope resolution froze the choice at first import, so any config change
// (feature flag, env, and soon a DB-driven model row) could not take effect
// without a full page reload. Both factories are cheap and stateless.

/** `embedded` — rendered inside the Ask Vyact drawer, which supplies its own
 *  board-spec header, so the page title block is suppressed to avoid showing
 *  two headings. The /chat route renders it standalone (embedded=false).
 *
 *  W7a (audit FE-PIP-17): one conversation per household. Switching household while the chat was
 *  open kept the old transcript in state and saved it under the NEW household's key; keying the
 *  component on the household gives each household a fresh mount that loads its own history. */
export default function Chat(props: { embedded?: boolean } = {}) {
  const householdId = useStore(s => s.currentHouseholdId);
  return <ChatForHousehold key={householdId} {...props} />;
}

function ChatForHousehold({ embedded = false }: { embedded?: boolean } = {}) {
  const txns    = useStore(s => s.transactions);
  const budgets = useStore(s => s.budgets);
  const goals   = useStore(s => s.goals);
  const debts   = useStore(s => s.debts);
  const assets  = useStore(s => s.assets);
  const accounts = useStore(s => s.accounts);
  const budgetAllocations = useStore(s => s.budgetAllocations);
  const profile = useStore(s => s.profile);
  const rates   = useStore(s => s.rates);
  const members = useStore(s => s.members);
  const recurring = useStore(s => s.recurringSchedules);
  const classifications = useCategoryClassifications();
  const householdId = useStore(s => s.currentHouseholdId);
  const openAddTxn    = useStore(s => s.openAddTxn);
  const openAddBudget = useStore(s => s.openAddBudget);
  const openAddDebt   = useStore(s => s.openAddDebt);
  const openEditDebt  = useStore(s => s.openEditDebt);
  const openAddAsset  = useStore(s => s.openAddAsset);
  const closeAsk      = useStore(s => s.closeAsk);
  const myRole        = useStore(s => s.myRole);
  const toast         = useStore(s => s.toast);

  const [history, setHistory] = useState<ChatRow[]>(() => {
    // Audit S5 — the transcript is household-scoped. One global 'chat_history'
    // key used to share a conversation across every household (and, on a shared
    // device, across users until the cache epoch purge). One-time: the legacy
    // global key seeds THIS household's transcript, then is removed.
    const key = `chat_history_${householdId}`;
    try {
      const scoped = ls.readJson<ChatRow[]>(key);
      // A turn interrupted mid-flight (tab closed, reload) was persisted with
      // `pending: true`; drop it so it never renders as permanently thinking.
      if (scoped) return scoped.filter(m => !m.pending);
      const legacy = ls.readJson<ChatRow[]>('chat_history');
      if (legacy) {
        try { ls.setJson(key, legacy); } catch { /* fault-ok: device storage is optional (private mode, quota); the old history stays where it was */ }
        try { localStorage.removeItem('vt_chat_history'); localStorage.removeItem('chat_history'); } catch { /* fault-ok: the old keys only take space; the history was copied above */ }
        return legacy;
      }
      return [];
    }
    catch { return []; }
  });
  const [input, setInput] = useState('');
  // Audit 6.5 — an ACTIVE TURN, not a boolean. `thinking` was a bare flag that
  // cleared before the simulated stream finished, and the stream rewrote the
  // LAST history item — so a new message sent mid-stream corrupted the prior
  // reply. A turn carries its own id and a cancel handle; the stream appends
  // by id and can never clobber another turn's row.
  const [activeTurn, setActiveTurn] = useState<{ id: string; cancel: () => void } | null>(null);
  const thinking = activeTurn !== null;
  // v7.4.5 — when an intent has secondary chips, hold it here so the
  // empty-state grid swaps to the tap-2 row.
  const [showExamples, setShowExamples] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Skip the very first history-effect run (mount/hydration) so opening Ask
  // Vyact stays scrolled to the TOP showing the intent options, instead of
  // auto-jumping to the bottom of the list.
  const didMountScroll = useRef(false);
  /**
   * v10.38.1 — the figures the LAST answered turn was allowed to state.
   *
   * 🔴 v10.38 read this off the transcript (`history.find(...)`), and in production
   * the guard still rejected a follow-up that quoted the previous answer's figures:
   * `history` is the value captured in this render's closure, so `send()` can read a
   * transcript older than the turn that just finished, and a rehydrated transcript
   * need not carry the field at all. A ref is written synchronously the moment a
   * turn resolves and cannot go stale — the transcript copy stays for persistence.
   */
  const lastAllowedRef = useRef<string[]>([]);
  /** v10.54.0 — turns the person stopped (Stop, or New chat). A stopped turn writes nothing more. */
  const cancelledTurns = useRef(new Set<string>());
  /** W8a (audit FE-PIP-16) — the in-flight turn's model calls; Stop, New chat and leaving the chat abort them. */
  const turnAbort = useRef<AbortController | null>(null);
  useEffect(() => () => { turnAbort.current?.abort(); }, []);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Proactive "what to know" card (spec §5) — at most one per session, dismissible,
  // only when the flag + bucket + proactiveInsight are on.
  const [proactive, setProactive] = useState<{ text: string; chipPrompt?: string } | null>(null);

  // Privacy-safe summary built from current state — never includes merchant names or descriptions
  const summary = useMemo(() => {
    // Audit F3/F5 — the assistant sees the same account-aware net worth and
    // allocation-derived budget lines the UI renders.
    // Track E, E4 — the live need/want map, as Reports reads it, so Pip's essential spend is Reports'.
    const s = buildSafeSummary(txns, budgets, goals, debts, assets, profile, rates, accounts, budgetAllocations, undefined, classifications);
    s.household.members = members.length;
    return s;
  }, [txns, budgets, goals, debts, assets, profile, rates, accounts, budgetAllocations, members.length, classifications]);

  useEffect(() => {
    // Audit S5 — persist under the household-scoped key (matches the init).
    ls.setJson(`chat_history_${householdId}`, history);
    // Only auto-scroll to the newest message on a real turn — never on open.
    if (!didMountScroll.current) { didMountScroll.current = true; return; }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history, householdId]);

  // Surface one proactive insight on open (rate-limited to one per session).
  useEffect(() => {
    if (!isAskVyactEnabled() || !FEATURES.askVyact.proactiveInsight) return;
    try { if (sessionStorage.getItem('askvyact_proactive_shown') === '1') return; } catch { /* fault-ok: storage unavailable: the greeting shows again */ }
    const ctx: AssistantContext = {
      summary, transactions: txns, budgets, budgetAllocations, goals, debts, assets, recurring,
      profile, rates, baseCurrency: profile.baseCurrency,
    };
    const insight = proactiveInsight(ctx);
    if (insight) {
      setProactive(insight);
      try { sessionStorage.setItem('askvyact_proactive_shown', '1'); } catch { /* fault-ok: storage unavailable: the greeting may show again */ }
    }
    // Run once on mount; summary is stable enough for a first-open insight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v10.107.0 — a Pip nudge opens /chat?ask=… with its question in the field, ready to send. It is
  // never sent for the person: asking is their choice (and a model call).
  useEffect(() => {
    if (embedded || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ask = (params.get('ask') ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!ask) return;
    setInput(ask);
    params.delete('ask');
    const rest = params.toString();
    appNavigate(`${window.location.pathname}${rest ? `?${rest}` : ''}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v10.36 — the composer is a multi-line textarea that grows with its content
  // up to max-h-48 (192px), then scrolls. Keyed on `input`, so it also resizes
  // when text is set programmatically (an example prefill) or cleared on send.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    // v10.54.0 — an empty field is always one row. Measuring it while the Ask
    // drawer is still sliding in read a near-zero width and fixed it at 192px.
    if (!input) { el.style.height = ''; return; }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [input]);

  /** v10.52.0 — a 'setup' intent opens its form. In the drawer, close the
   *  drawer first: forms are routes (modalSlice), and navigating underneath an
   *  open drawer is what made the old Manage chips read as dead (v10.17). */
  const setupIntents = intentsByBucket('setup').filter(intent => !intent.requires || can(myRole, intent.requires));
  function openSetup(intent: Intent) {
    const action = intent.action;
    if (action?.kind !== 'open-modal') return;
    if (embedded) closeAsk();
    if (action.modal === 'addBudget') openAddBudget();
    else if (action.modal === 'addDebt') openAddDebt();
    else if (action.modal === 'addAsset') openAddAsset();
  }

  function prepareQuestion(question: string) {
    setInput(question);
    inputRef.current?.focus();
  }

  async function send(question: string) {
    // Audit 6.5 — one turn at a time. `thinking` === activeTurn !== null, so a
    // send during an in-flight stream is refused and can never interleave rows.
    if (!question.trim() || activeTurn) return;
    const userMsg: ChatMessage = { role: 'user', content: question };
    // v10.36 — the reply row is created at the START of the turn rather than
    // after it, so its analysis steps can be printed live while the model works.
    // Every later write targets this row by turnId (audit 6.5): a message
    // appended mid-turn can never be corrupted by this turn's writes.
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setHistory(h => [...h, userMsg, { role: 'assistant', content: '', turnId, steps: [], pending: true }]);
    setInput('');
    // Mark the turn active immediately (streamReply replaces this with the
    // cancellable record). The 'pending:' id keeps the finally-block guard from
    // clearing it early. v10.54.0 — Stop works here too: it marks the turn
    // cancelled, so the answer is dropped when it arrives and no form opens. The
    // marker carries this turn's id so a stopped turn's late `finally` can never
    // clear the marker of a newer turn.
    const pendingId = `pending:${turnId}`;
    turnAbort.current?.abort();
    const abort = new AbortController();
    turnAbort.current = abort;
    setActiveTurn({ id: pendingId, cancel: () => { cancelledTurns.current.add(turnId); abort.abort(); } });

    // AI-P0 — telemetry is logged AFTER the turn so it can carry which engine
    // answered and the outcome. Still privacy-safe: intent + sentiment + length
    // + call metadata only, never the message text.
    const startedAt = Date.now();
    // v10.106.3 — where the time went (classify and phrase round trips, before / between / after),
    // logged as ai_usage.stage_ms so a slow total can be split. Numbers only, never text.
    const timer = createTurnTimer();
    const patchTurn = (patch: Partial<ChatRow>) =>
      setHistory(h => h.map(m => (m.turnId === turnId ? { ...m, ...patch } : m)));
    const addStep = (step: string) =>
      setHistory(h => h.map(m => (m.turnId === turnId ? { ...m, steps: [...(m.steps ?? []), step] } : m)));

    try {
      // Ask Vyact assistant (spec §3). When the flag is OFF this whole branch is
      // skipped and the launcher behaves exactly as it did in v7.4.5.
      if (isAskVyactEnabled()) {
        // The same backend selectAssistantBackend builds, with each model call timed.
        const modelCall = selectModelCall(householdId, abort.signal);
        const assistantBackend = modelCall ? new LlmBackend(timer.wrap(modelCall)) : null;
        const ctx: AssistantContext = {
          summary, transactions: txns, budgets, budgetAllocations, goals, debts, assets, recurring,
          profile, rates, baseCurrency: profile.baseCurrency,
          // v10.38 — ids and names only, so a bank message naming a card can seed the
          // paying account on the form.
          accounts: accounts.map(a => ({ id: a.id, name: a.name, kind: a.kind })),
        };
        // A null backend means no model is configured. runAssistant turns that
        // into an explicit "unavailable" turn rather than a fabricated answer.
        // `addStep` receives each real pipeline stage as it happens.
        // v10.38 — the previous assistant turn's figures travel with the question so
        // a follow-up can cite the number it is challenging without the guard
        // discarding the whole answer.
        // Prefer the ref (never stale); fall back to the transcript so a reloaded
        // session still lets the first follow-up cite what it can see on screen.
        const prevAllowed = lastAllowedRef.current.length
          ? lastAllowedRef.current
          : [...history].reverse()
            .find(m => m.role === 'assistant' && m.allowedFigures?.length)?.allowedFigures ?? [];
        const turn = await runAssistant(question, ctx, assistantBackend, Date.now(), addStep, prevAllowed);
        const stopped = cancelledTurns.current.has(turnId);
        if (!stopped) lastAllowedRef.current = turn.allowedFigures ?? [];
        void logAiUsage({
          householdId, text: question, surface: 'chat',
          backend: assistantBackend?.id ?? 'llm',
          tier: 't1',
          outcome: turn.intentId === 'unavailable' ? 'error'
            : turn.clarify ? 'clarify'
            : turn.intentId === 'fallback' ? 'fallback' : 'ok',
          latencyMs: Date.now() - startedAt,
          stageMs: timer.stages(),
        });
        if (stopped) return;
        // The analysis is finished: freeze its duration, then stream the answer
        // into the same row. The turn stays active until the stream resolves, so
        // a concurrent send is blocked by `thinking` and can never clobber it.
        // (The old artificial 600ms "thinking" pause is gone — the real analysis
        // steps now show that work is happening.)
        patchTurn({ pending: false, thinkingMs: Date.now() - startedAt });
        await streamReply(turnId, turn.reply, turn.chips, turn.allowedFigures);
        if (cancelledTurns.current.has(turnId)) return;
        // v10.107.0 — a concept question points to Learn's lessons with a button.
        if (turn.link) patchTurn({ link: turn.link });
        // v10.38 — capture seeds the EXISTING TransactionFormModal, and only AFTER
        // the acknowledgement is on screen. Navigating first replaced the chat with
        // the form before the user could read what had been understood, so the
        // confirmation they expected first arrived last or not at all.
        // W4c (D18): a split capture carries a split, and the store opens the Split form for it.
        // Aurora 4.0 PIP2 — any other capture is confirmed IN the chat: a card with Save and Edit in
        // form (CaptureCard), so the form replaces the chat only when asked.
        if (turn.seed) {
          if (turn.seed.split) openAddTxn(turn.seed);
          else patchTurn({ capture: { seed: turn.seed } });
        }
        // v10.39.1 (P21) — a recurring draft opens the Recurring section's own sheet,
        // the only place a schedule is authored; the user picks the account and saves.
        if (turn.recurringSeed) appNavigate('/recurring', { state: { recurringSeed: turn.recurringSeed } });
        // v10.109.0 (owner, R-1) — an EMI is set up on its LOAN: Add loan pre-filled, or that loan, with
        // Record automatically on. The drawer closes first, as for any form (openSetup).
        if (turn.loanSeed) {
          const loanSeed = turn.loanSeed;
          if (embedded) closeAsk();
          if (loanSeed.mode === 'new') openAddDebt(loanSeed);
          else {
            const loan = useStore.getState().debts.find(d => d.id === loanSeed.debtId);
            if (loan) openEditDebt(loan, loanSeed);
          }
        }
        setActiveTurn(null);
        return;
      }
      // Ask Vyact is the ONLY assistant (v10.20). With the feature flag off there
      // is no second engine to fall through to — the old ChatBackend path was
      // removed with its browser-side key. Say so plainly rather than routing the
      // user to something they were never told about. No model was called, so no
      // usage row (T5c, FE-PIP-09).
      patchTurn({ content: 'The assistant is turned off right now.', pending: false });
    } catch (e) {
      void logAiUsage({
        householdId, text: question, surface: 'chat',
        outcome: 'error', latencyMs: Date.now() - startedAt, stageMs: timer.stages(),
      });
      // Aurora 4.0 PIP1 — never the raw error ("Error: Failed to fetch"): say nothing was saved, offer
      // Try again, and keep the question in the box. The technical detail goes to the console only.
      console.warn('Pip turn failed', e);
      patchTurn({ content: 'I couldn’t answer that just now, and nothing was saved. Check your connection and try again.', pending: false, failedQuestion: question });
      setInput(cur => cur || question);
    } finally {
      // The stream path clears activeTurn itself after the reply settles; the
      // off / error paths never started a stream, so clear any pending marker.
      setActiveTurn(t => (t && t.id === pendingId ? null : t));
    }
  }

  // #4 — stream an assistant reply word-by-word (resolves when complete).
  //
  // Audit 6.5 — the reply row carries a unique `turnId` and the interval writes
  // THAT row, matched by id, never "the last item". A new message arriving
  // mid-stream appends its own rows; this stream keeps writing its own row and
  // cannot corrupt it. `chips` attach only once the last word lands (#62).
  function streamReply(
    turnId: string, text: string, chips?: AssistantChip[],
    /** v10.38 — kept on the row so the NEXT turn's guard accepts a figure the user challenges. */
    allowedFigures?: string[],
  ): Promise<void> {
    return new Promise(resolve => {
      const words = text.split(' ');
      // v10.36 — the row already exists: it was created when the turn started so
      // its analysis could print live. Every update targets it by id — immune to
      // anything appended after it.
      let i = 0;
      const id = setInterval(() => {
        i += 1;
        const partial = words.slice(0, i).join(' ');
        const done = i >= words.length;
        setHistory(h => h.map(msg =>
          msg.turnId === turnId
            ? { ...msg, content: partial,
                ...(done && chips ? { chips } : {}),
                ...(done && allowedFigures?.length ? { allowedFigures } : {}) }
            : msg,
        ));
        if (done) { clearInterval(id); resolve(); }
      }, 40);
      // Register the cancellable turn so the UI can stop it and `thinking`
      // (activeTurn) stays true until the stream settles.
      setActiveTurn({
        id: turnId,
        cancel: () => { cancelledTurns.current.add(turnId); clearInterval(id); resolve(); },
      });
    });
  }

  // #6 — voice input via the Web Speech API (feature-detected; hidden if absent).
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const retryCount = useRef(0);
  const SpeechRec = typeof window !== 'undefined'
    ? (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    : undefined;

  function stopVoice() {
    if (recRef.current) {
      try { recRef.current.stop(); } catch { /* fault-ok: the recogniser was already stopped */ }
      recRef.current = null;
    }
    setListening(false);
    setInterimText('');
    retryCount.current = 0;
  }

  function startVoice() {
    if (!SpeechRec) return;
    if (listening) { stopVoice(); return; }
    try {
      const rec = new (SpeechRec as new () => SpeechRecognitionLike)();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 1;
      recRef.current = rec;
      retryCount.current = 0;
      setListening(true);
      setInterimText('');

      rec.onresult = (ev: SpeechRecognitionEventLike) => {
        let interim = '';
        let final = '';
        for (let i = ev.resultIndex; i < Object.keys(ev.results).length; i++) {
          const result = ev.results[i];
          const transcript = result?.[0]?.transcript ?? '';
          if (result?.isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }
        if (final) {
          setInput(prev => (prev ? prev + ' ' : '') + final.trim());
          setInterimText('');
        } else {
          setInterimText(interim);
        }
      };

      rec.onerror = (ev: SpeechRecognitionErrorLike) => {
        if (ev.error === 'no-speech' && retryCount.current < 2) {
          retryCount.current += 1;
          return;
        }
        const messages: Record<string, string> = {
          'no-speech': 'No speech detected — tap the mic to try again',
          'audio-capture': 'Microphone not available',
          'not-allowed': 'Microphone permission denied — enable it in browser settings',
          'aborted': '',
        };
        const msg = messages[ev.error] ?? `Voice error: ${ev.error}`;
        if (msg) toast(msg, 'error');
        stopVoice();
      };

      rec.onend = () => {
        setListening(false);
        setInterimText('');
        recRef.current = null;
      };

      rec.start();
    } catch {
      toast('Voice input not supported in this browser', 'error');
      setListening(false);
    }
  }

  // v10.54.0 (owner) — "New chat" replaces "Clear history": no confirmation, no
  // delete wording. It leaves the current conversation (an answer still being
  // written is stopped) and starts a fresh one.
  /** PIP1 — ask the failed question again (its two rows are replaced by the new turn). */
  function retry(i: number) {
    const question = history[i]?.failedQuestion;
    if (!question || thinking) return;
    setHistory(h => h.filter((_, idx) => idx !== i && idx !== i - 1));
    setInput('');
    void send(question);
  }

  function newChat() {
    activeTurn?.cancel();
    setActiveTurn(null);
    track('ask_new_chat', { count: history.length });
    setHistory([]);
    setInput('');
    setShowExamples(false);
    ls.removeBoth('chat_history');
    inputRef.current?.focus();
  }

  /** Stop the answer in progress. One that never started leaves nothing behind;
   *  a partly written one stays as written. */
  function stopTurn() {
    if (!activeTurn) return;
    activeTurn.cancel();
    setActiveTurn(null);
    setHistory(h => h
      .filter(m => !(m.role === 'assistant' && !m.content))
      .map(m => (m.pending ? { ...m, pending: false } : m)));
  }

  /** The question an answer replied to — read only to classify its intent. */
  function questionFor(i: number): string {
    for (let j = i - 1; j >= 0; j--) if (history[j].role === 'user') return history[j].content;
    return '';
  }

  async function copyAnswer(i: number) {
    const m = history[i];
    if (!m?.content) return;
    try { await navigator.clipboard.writeText(m.content); }
    catch { toast("Couldn't copy the answer", 'error'); return; }
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx(c => (c === i ? null : c)), 1500);
    track('ask_copy', { intent: classifyIntent(questionFor(i)) });
  }

  /** 👍 / 👎 — tapping the chosen one again takes the rating back. */
  function rateAnswer(i: number, rating: 1 | -1) {
    const m = history[i];
    if (!m || m.role !== 'assistant') return;
    const next = m.feedback === rating ? null : rating;
    setHistory(h => h.map((row, idx) => (idx === i ? { ...row, feedback: next ?? undefined } : row)));
    const question = questionFor(i);
    track('ask_feedback', { rating: next === 1 ? 'up' : next === -1 ? 'down' : 'none', intent: classifyIntent(question) });
    if (m.turnId) void saveFeedback({ householdId, turnId: m.turnId, rating: next, question, answerLength: m.content.length });
  }

  // v10.54.0 — the WhatsApp entry point lives in Pip itself (no trip to Settings).
  const [waOpen, setWaOpen] = useState(false);
  function openWhatsApp() {
    track('whatsapp_connect_opened', { surface: embedded ? 'ask_drawer' : 'ask_page' });
    setWaOpen(true);
  }

  const toolbar = (
    <div className="flex items-center gap-1.5">
      {isCloudEnabled() && (
        <button type="button" onClick={openWhatsApp} aria-label="Chat with Pip on WhatsApp" title="Chat with Pip on WhatsApp"
          className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 rounded-pill border border-line text-[12.5px] text-ink-mid hover:text-ink hover:border-line2">
          <WhatsAppIcon size={15} className="text-[#25D366]" /> WhatsApp
        </button>
      )}
      <button type="button" onClick={newChat} disabled={history.length === 0 && !thinking} aria-label="New chat" title="New chat"
        className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 rounded-pill border border-line text-[12.5px] text-ink-mid hover:text-ink hover:border-line2 disabled:opacity-40 disabled:cursor-not-allowed">
        <Plus size={15} aria-hidden /> New chat
      </button>
    </div>
  );

  return (
    <div className={`ui-pilot reading-surface ${embedded ? 'flex flex-col flex-1 min-h-0' : 'lg:flex lg:flex-col lg:h-[calc(100dvh-8.5rem)] lg:min-h-[32rem]'}`}>
      {/* FIT3 — on phones the heading is hidden (the mobile header says "Pip") and WhatsApp and
          New chat sit right-aligned in one row. */}
      {!embedded && (
        <PageHead
          title={<span className="flex items-center gap-2.5"><MessageCircle className="text-coral" /> Pip</span>}
          subtitle="Record money · understand your household · explore a decision"
          aside={toolbar}
        />
      )}
      {embedded && <div className="flex justify-end mb-2.5">{toolbar}</div>}
      <WhatsAppConnectSheet open={waOpen} onClose={() => setWaOpen(false)} />

      {/* v10.52.0 (owner) — the green "Vyact does the maths…" banner above the
          chat was removed. The honest caveat now sits under the composer, where
          it's read at the moment of asking: Pip is AI-based and can be wrong. */}
      <Panel className={embedded ? 'flex-1 min-h-0 flex flex-col' : 'lg:flex-1 lg:min-h-0 lg:flex lg:flex-col'}>
        <div ref={scrollRef} data-testid="ask-scroll" className={`px-4 py-4 space-y-3 overflow-y-auto overflow-x-hidden ${embedded ? 'flex-1 min-h-0' : 'max-h-[28rem] min-h-[20rem] lg:max-h-none lg:min-h-0 lg:flex-1'}`}>
          {history.length === 0 && proactive && (
            <div className="mb-4 bg-coral-tint border border-coral/30 rounded-md p-3 flex items-start gap-3">
              <div className="flex-1 text-[0.84rem] text-ink leading-snug">{proactive.text}</div>
              <div className="flex items-center gap-2 shrink-0">
                {proactive.chipPrompt && (
                  <button
                    onClick={() => { const p = proactive.chipPrompt!; setProactive(null); prepareQuestion(p); }}
                    className="text-[12px] font-semibold text-coral hover:underline min-h-[44px]"
                  >
                    Use question
                  </button>
                )}
                <button onClick={() => setProactive(null)} className="text-ink-dim hover:text-ink text-[12px] min-h-[44px]">
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {(history.length === 0 || showExamples) && (
            <div className="py-1">
              {/* v10.52.0 — compact empty state. Each example is ONE chip: tapping
                  it puts the full sentence in the box to edit and Send, so the
                  sentence no longer needs printing under every row (it's the
                  chip's tooltip). The old layout printed label, a 44px pencil
                  button, the sentence and a hint per intent: 14 tall rows. The
                  three that are not chat commands (budget, debt, asset) were
                  rows with no button at all; they're now real buttons that open
                  their form ('Set up with a form'). */}
              <p className="text-[12px] text-ink-dim mb-3 leading-relaxed">
                Tap an example to put it in the box, change the details, then Send. Check any proposed entry before you save it.
              </p>
              <div className="space-y-3">
                {BUCKETS.map(b => {
                  const items = intentsByBucket(b).filter(intent => intentExample(intent));
                  if (!items.length) return null;
                  return (
                    <section key={b} aria-label={BUCKET_LABEL[b]}>
                      <h3 className="ui-label mb-1.5">{BUCKET_LABEL[b]}</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {items.map(intent => {
                          const example = intentExample(intent)!;
                          return (
                            <button key={intent.id} type="button" data-testid={`ask-intent-${intent.id}`}
                              aria-label={`Use example: ${intent.label}`} title={example}
                              onClick={() => prepareQuestion(example)} disabled={thinking}
                              className={CHIP_CLASS} style={CHIP_STYLE}>
                              <span aria-hidden>{intent.icon}</span>
                              <span className="truncate">{intent.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
                {setupIntents.length > 0 && (
                  <section aria-label={BUCKET_LABEL.setup}>
                    <h3 className="ui-label mb-1.5">{BUCKET_LABEL.setup}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {setupIntents.map(intent => (
                        <button key={intent.id} type="button" data-testid={`ask-intent-${intent.id}`}
                          title={intent.inputHint} onClick={() => openSetup(intent)}
                          className={CHIP_CLASS} style={CHIP_STYLE}>
                          <span aria-hidden>{intent.icon}</span>
                          <span className="truncate">{intent.label}</span>
                          <ArrowUpRight size={13} aria-hidden className="text-ink-dim shrink-0" />
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>
          )}
          {history.map((m, i) => {
            // v10.54.0 (owner) — while Pip works on an answer nothing is offered and
            // nothing is narrated: no "Thinking…", no pipeline steps, no "Analysed
            // in Ns". Just a quiet typing indicator until the answer appears.
            const streaming = !!m.turnId && activeTurn?.id === m.turnId;
            const answered = m.role === 'assistant' && !m.pending && !!m.content && !streaming;
            return (
            <div key={i}>
              {m.role === 'assistant' && !m.content && (m.pending || streaming) && (
                <div className="flex justify-start" data-testid="ask-typing">
                  <span className="sr-only" role="status">Pip is answering</span>
                  <div aria-hidden className="ask-typing inline-flex items-center gap-1 px-4 py-3"
                    style={{ background: 'var(--canvas)', borderRadius: '18px 18px 18px 6px', boxShadow: 'var(--neu-sm)' }}>
                    <span /><span /><span />
                  </div>
                </div>
              )}
              {(m.role === 'user' || m.content) && (
                <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {/* Board D — .bub: user coral + accent-ink, AI neu canvas. */}
                  <div className="max-w-[85%] px-4 py-2.5 text-[0.86rem] leading-relaxed"
                    style={m.role === 'user'
                      ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: '18px 18px 6px 18px', boxShadow: 'var(--neu-sm)' }
                      : { background: 'var(--canvas)', color: 'var(--ff-ink)', borderRadius: '18px 18px 18px 6px', boxShadow: 'var(--neu-sm)' }}>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </div>
                </div>
              )}
              {m.capture && !streaming && (
                <CaptureCard seed={m.capture.seed} saved={!!m.capture.saved}
                  onSaved={() => setHistory(h => h.map((row, idx) => (idx === i && row.capture ? { ...row, capture: { ...row.capture, saved: true } } : row)))}
                  onEdit={() => { const seed = m.capture!.seed; if (embedded) closeAsk(); openAddTxn(seed); }} />
              )}
              {m.failedQuestion && i === history.length - 1 && !thinking && (
                <button type="button" onClick={() => retry(i)} data-testid="ask-retry"
                  className="btn-ghost mt-2 inline-flex items-center gap-1.5">
                  <RotateCcw size={14} aria-hidden /> Try again
                </button>
              )}
              {/* v10.54.0 (owner) — under every finished answer: copy, 👍, 👎. Ratings
                  go to GA (ask_feedback) and the admin console (ai_feedback); never
                  the question or the answer itself. */}
              {answered && !m.failedQuestion && (
                <div className="flex items-center gap-0.5 mt-1 ml-1" data-testid="ask-answer-actions">
                  <button type="button" onClick={() => void copyAnswer(i)} aria-label="Copy answer" title="Copy"
                    className="w-8 h-8 inline-flex items-center justify-center rounded-full text-ink-dim hover:text-ink hover:bg-bg3">
                    {copiedIdx === i ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                  </button>
                  <button type="button" onClick={() => rateAnswer(i, 1)} aria-label="Good answer" title="Good answer" aria-pressed={m.feedback === 1}
                    className={`w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-bg3 ${m.feedback === 1 ? 'text-coral' : 'text-ink-dim hover:text-ink'}`}>
                    <ThumbsUp size={14} aria-hidden fill={m.feedback === 1 ? 'currentColor' : 'none'} />
                  </button>
                  <button type="button" onClick={() => rateAnswer(i, -1)} aria-label="Bad answer" title="Bad answer" aria-pressed={m.feedback === -1}
                    className={`w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-bg3 ${m.feedback === -1 ? 'text-coral' : 'text-ink-dim hover:text-ink'}`}>
                    <ThumbsDown size={14} aria-hidden fill={m.feedback === -1 ? 'currentColor' : 'none'} />
                  </button>
                </div>
              )}
              {m.role === 'assistant' && m.link && !m.pending && (
                <div className="mt-2.5">
                  <Button variant="ghost" data-testid="ask-vyact-link"
                    onClick={() => { const to = m.link!.to; if (embedded) closeAsk(); appNavigate(to); }}>
                    <BookOpen size={14} aria-hidden /> {m.link.label}
                  </Button>
                </div>
              )}
              {/* Follow-up chips (#62) — the deck's response anatomy part 4.
                  Only under the LAST turn: a chip is "the next question", and
                  the next question only makes sense after the newest answer.
                  Older turns keep their chips in the transcript (they are part
                  of what was said) but stop being tappable, so scrolling back
                  cannot silently re-ask something from ten turns ago. */}
              {m.role === 'assistant' && m.chips && m.chips.length > 0 && i === history.length - 1 && !thinking && (
                <div className="mt-2.5 min-w-0" data-testid="ask-vyact-chips">
                  <div className="ui-label mb-1.5">Ask next</div>
                  <div className="flex flex-wrap gap-1.5">
                    {m.chips.map((c, ci) => (
                      <button key={ci} type="button" onClick={() => prepareQuestion(c.prompt)} data-testid={`ask-vyact-chip-${ci}`}
                        title={c.prompt} aria-label={`Use question: ${c.prompt}`}
                        className={`${CHIP_CLASS} text-left whitespace-normal [overflow-wrap:anywhere]`} style={CHIP_STYLE}>
                        {c.label || c.prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>

        {history.length > 0 && <Button variant="ghost" onClick={() => setShowExamples(value => !value)} aria-expanded={showExamples}>
          <List size={14} aria-hidden /> {showExamples ? 'Hide examples' : 'Show examples'}
        </Button>}
        <div className="border-t border-line px-3 pt-3 pb-3 flex-shrink-0">
          {/* v10.54.0 (owner design) — one rounded field: the question on top, the
              mic and send beneath it. While Pip answers, send becomes stop; the
              field never says "thinking". */}
          {listening && (
            <div className="flex items-center gap-2.5 mb-2 px-3 py-2 rounded-r2 well" data-testid="ask-listening" role="status" aria-live="polite">
              <span aria-hidden className="w-2.5 h-2.5 rounded-full flex-shrink-0 animate-pulse" style={{ background: 'hsl(var(--terra))' }} />
              <span className="flex-1 min-w-0 text-[13px] text-ink truncate">{interimText || 'Listening… say what you spent or ask a question'}</span>
              <button type="button" onClick={stopVoice} className="min-h-[44px] sm:min-h-[36px] px-3 rounded-pill text-[12.5px] font-medium"
                style={{ color: 'var(--crit-text)' }}>Stop</button>
            </div>
          )}
          <div className="ask-composer px-3.5 pt-2.5 pb-2" data-testid="ask-composer">
            <label htmlFor={embedded ? 'ask-drawer-input' : 'ask-page-input'} className="sr-only">Your question or entry</label>
            {/* Enter sends; Shift+Enter inserts a new line. `isComposing` stops an
                IME confirmation keystroke from sending a half-typed question. */}
            <textarea ref={inputRef} id={embedded ? 'ask-drawer-input' : 'ask-page-input'}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }}
              placeholder="Ask me anything…"
              className="block w-full min-h-[2rem] max-h-48 py-1 overflow-x-hidden text-[0.92rem] leading-snug text-ink placeholder:text-ink-dim"
            />
            <div className="flex items-center justify-end gap-1.5 mt-1">
              {Boolean(SpeechRec) && (
                <button
                  type="button" onClick={listening ? stopVoice : startVoice} aria-label={listening ? 'Stop listening' : 'Voice input'}
                  title={listening ? 'Stop' : 'Speak'} aria-pressed={listening}
                  className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full transition-colors ${listening ? 'text-coral bg-coral/10 animate-pulse' : 'text-ink-mid hover:text-ink hover:bg-bg3'}`}>
                  <Mic size={18} aria-hidden />
                </button>
              )}
              {thinking ? (
                <button type="button" onClick={stopTurn} aria-label="Stop" title="Stop"
                  className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full bg-ink text-bg transition-transform active:scale-95">
                  <Square size={13} aria-hidden fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button" onClick={() => send(input)} disabled={!input.trim()}
                  aria-label="Send" title="Send"
                  className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full bg-coral text-[color:var(--accent-ink)] transition-all hover:scale-105 active:scale-95 disabled:opacity-35 disabled:pointer-events-none">
                  <ArrowUp size={18} aria-hidden />
                </button>
              )}
            </div>
          </div>
          {/* v10.52.0 (owner) — replaces the "Vyact does the maths" banner. */}
          <p className="mt-2 px-1 text-[11.5px] leading-snug text-ink-dim" data-testid="ask-ai-disclaimer">
            Pip is AI-based and can make mistakes. Please double-check its responses.
          </p>
        </div>
      </Panel>
    </div>
  );
}
