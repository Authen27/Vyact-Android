// TD-07 — Google Gemini chat backend.
//
// Why client-side direct-to-Google instead of a Supabase Edge Function?
//   - Zero new server infra. The free tier is generous (Gemini 1.5 Flash:
//     ~15 RPM / 1,500 RPD as of 2026-06) and the API key sits behind a
//     Google-side per-key referrer/IP/method allow-list, so leaking it
//     from a browser bundle is the expected operational mode for this
//     plan tier. Users who want a hard secret can still wire an Edge
//     Function later and swap the backend factory below — the
//     `ChatBackend` interface is unchanged.
//   - Honest with the existing privacy contract: only the SafeSummary
//     (no merchant names, no transaction descriptions) is sent.
//
// Free-tier model: defaults to `gemini-1.5-flash` (per user request,
// version 1.5 or below). The `-latest` alias was retired for some keys
// / regions in 2026; the plain id stays valid. Override via
// `VITE_GEMINI_MODEL` if Google retires it again.

import type { ChatBackend, ChatMessage, SafeSummary } from './aiSummary';

const DEFAULT_MODEL = 'gemini-1.5-flash';

function resolveModel(): string {
  try {
    const m = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_GEMINI_MODEL;
    if (m && m.trim()) return m.trim();
  } catch { /* fall through */ }
  return DEFAULT_MODEL;
}

function endpointFor(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

const SYSTEM_PROMPT = `You are Vyact's family-finance coach.

You will receive a JSON "summary" object describing a household's current
finances at an aggregate level (categories, totals, ratios, trends — never
merchant names or transaction descriptions). Answer the user's question
using ONLY that summary plus the conversation so far.

Rules:
- Be concise: 1–3 short paragraphs, no preamble.
- Quote concrete numbers from the summary; never invent figures.
- If the summary lacks the data needed, say so plainly and suggest which
  Vyact page to visit (Budgets, Goals, Debts, Net Worth, etc.).
- No legal, tax, or regulated investment advice. Generic education only.
- Currency is whatever \`summary.baseCurrency\` says.`;

interface GeminiPart { text: string }
interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }

function toGeminiHistory(history: ChatMessage[]): GeminiContent[] {
  return history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
}

export class GeminiChatBackend implements ChatBackend {
  private readonly model: string;
  constructor(private readonly apiKey: string, model?: string) {
    if (!apiKey) throw new Error('GeminiChatBackend requires a non-empty API key');
    this.model = model ?? resolveModel();
  }

  isReal() { return true; }

  async ask(question: string, summary: SafeSummary, history: ChatMessage[]): Promise<string> {
    // The summary is bundled into the first user turn so Gemini's
    // multi-turn history stays clean (role alternation: user/model/user/…).
    const priming =
      `You are answering a question about MY household finances. ` +
      `Ground every claim in the JSON summary below — do not give generic financial advice ` +
      `that ignores these numbers.\n\n` +
      `Household summary (JSON):\n\`\`\`json\n${JSON.stringify(summary)}\n\`\`\`\n\n` +
      `My question: ${question}`;

    const body = {
      // Per Gemini REST spec systemInstruction takes { parts } only — adding
      // a role field makes some model aliases silently drop the instruction,
      // which is why the model previously answered as a generic chatbot.
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        ...toGeminiHistory(history),
        { role: 'user' as const, parts: [{ text: priming }] },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 512,
        candidateCount: 1,
      },
      // Light safety relaxation so debt / financial-distress questions
      // aren't blocked. Gemini's defaults are tuned for general content
      // and over-trigger on words like "loan", "debt", "owe".
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    };

    const res = await fetch(endpointFor(this.model), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Header auth matches the documented curl recipe and keeps the
        // key out of URL access logs / Referer.
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Gemini returns JSON errors; surface the message so users see
      // "API key invalid" / "Quota exceeded" rather than a bare 4xx.
      let detail = `HTTP ${res.status}`;
      try {
        const j = await res.json() as { error?: { message?: string } };
        if (j.error?.message) detail = j.error.message;
      } catch { /* keep HTTP code */ }
      throw new Error(`Gemini request failed: ${detail}`);
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };

    if (data.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the request (${data.promptFeedback.blockReason}). Try rephrasing.`);
    }

    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim();
    if (!text) {
      const reason = data.candidates?.[0]?.finishReason ?? 'EMPTY_RESPONSE';
      throw new Error(`Gemini returned no text (${reason}).`);
    }
    return text;
  }
}
