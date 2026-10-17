// Vyact Agent — the Amazon Bedrock path of the model router (owner, 16 Oct 2026: Nova Lite powers Pip).
//
// The router's guarantees hold on this path too: the OFF state reads nothing and calls nothing, a
// credential is read by NAME and never leaves the router, a config row cannot point AWS credentials at
// another host, the request is bounded, and the call never throws. SigV4 is checked against AWS's own
// published example, so the signer is right before it ever meets Bedrock.
import { describe, it, expect, vi } from 'vitest';
import {
  chatCompletion, checkConfig, buildUsageRow, type ModelConfigRow,
} from '../../../../supabase/functions/_shared/agent/router';
import {
  signSigV4, toConverseBody, parseConverse, bedrockEndpoint, bedrockErrorHint, isBedrockProvider,
} from '../../../../supabase/functions/_shared/agent/bedrock';

const nova = (over: Partial<ModelConfigRow> = {}): ModelConfigRow => ({
  id: 'cfg-nova', seam: 'assistant', provider: 'bedrock', model: 'amazon.nova-lite-v1:0',
  base_url: 'https://bedrock-runtime.ap-southeast-2.amazonaws.com', key_env_var: 'AWS_ACCESS_KEY_ID',
  params: { max_tokens: 600, temperature: 0.2, price_per_mtok_input: 0.063, price_per_mtok_output: 0.252 },
  enabled: true, priority: 120, ...over,
} as ModelConfigRow);

const converseReply = (text: string) => ({
  output: { message: { role: 'assistant', content: [{ text }] } },
  stopReason: 'end_turn',
  usage: { inputTokens: 1200, outputTokens: 80, totalTokens: 1280 },
});

const okFetch = (reply: unknown, status = 200) => vi.fn(async () =>
  new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

const iamEnv = (over: Record<string, string> = {}) => vi.fn((name: string) => ({
  AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', ...over,
} as Record<string, string>)[name] ?? '');

describe('SigV4 — matches AWS\'s published example', () => {
  it('BEDROCK-SIG-001 · the IAM ListUsers example signs to AWS\'s documented signature', async () => {
    const h = await signSigV4({
      method: 'GET',
      url: new URL('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08'),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: '',
      region: 'us-east-1', service: 'iam',
      accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      date: new Date('2015-08-30T12:36:00Z'),
    });
    expect(h['x-amz-date']).toBe('20150830T123600Z');
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, '
      + 'SignedHeaders=content-type;host;x-amz-date, '
      + 'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
    expect(h.host).toBeUndefined();   // fetch sets Host; it was signed with the same value
  });

  it('BEDROCK-SIG-002 · a session token is sent and signed', async () => {
    const h = await signSigV4({
      method: 'POST', url: new URL('https://bedrock-runtime.ap-southeast-2.amazonaws.com/model/amazon.nova-lite-v1%3A0/converse'),
      headers: { 'content-type': 'application/json' }, body: '{}', region: 'ap-southeast-2', service: 'bedrock',
      accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN', date: new Date('2026-10-16T09:00:00Z'),
    });
    expect(h['x-amz-security-token']).toBe('TOKEN');
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/20261016\/ap-southeast-2\/bedrock\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/);
  });
});

describe('Bedrock config — only a Bedrock host, only AWS credential names', () => {
  it('BEDROCK-CFG-001 · a Nova Lite row resolves to the Converse endpoint for its region', () => {
    expect(checkConfig(nova())).toEqual({ ok: true,
      endpoint: 'https://bedrock-runtime.ap-southeast-2.amazonaws.com/model/amazon.nova-lite-v1%3A0/converse' });
    expect(checkConfig(nova({ model: 'apac.amazon.nova-lite-v1:0', key_env_var: 'AWS_BEARER_TOKEN_BEDROCK' })).ok).toBe(true);
    expect(isBedrockProvider('bedrock') && isBedrockProvider('AWS-Bedrock') && !isBedrockProvider('openrouter')).toBe(true);
  });

  it('BEDROCK-CFG-002 · AWS credentials can never be pointed at another host or another provider', () => {
    for (const base of ['https://evil.example.com', 'http://bedrock-runtime.ap-southeast-2.amazonaws.com',
      'https://bedrock-runtime.ap-southeast-2.amazonaws.com.evil.io', 'https://bedrock.ap-southeast-2.amazonaws.com']) {
      expect(checkConfig(nova({ base_url: base })).code, base).toBe('invalid_config');
    }
    // An OpenAI-compatible row may not read AWS keys at all.
    expect(checkConfig({ ...nova(), provider: 'openrouter', base_url: 'https://openrouter.ai/api' }).code).toBe('forbidden_key');
    // A Bedrock row may read only AWS credential names.
    expect(checkConfig(nova({ key_env_var: 'OPENROUTER_API_KEY' })).code).toBe('forbidden_key');
    expect(checkConfig(nova({ key_env_var: 'SUPABASE_SERVICE_ROLE_KEY' })).code).toBe('forbidden_key');
    expect(checkConfig(nova({ key_env_var: null })).code).toBe('invalid_config');
    expect(checkConfig(nova({ model: '../../admin' })).code).toBe('invalid_config');
  });

  it('BEDROCK-CFG-003 · a disabled Bedrock row is the OFF state: no secret read, no call, no metering', async () => {
    const readEnv = vi.fn(() => 'x');
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await chatCompletion([{ role: 'user', content: 'hi' }], { config: null, readEnv, fetchImpl });
    expect(r.ok).toBe(false);
    expect(readEnv).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(buildUsageRow(r)).toBeNull();
  });
});

describe('Bedrock call — Converse in, the router\'s result out', () => {
  it('BEDROCK-CALL-001 · IAM keys: a SigV4-signed Converse call; system prompt, turns and caps mapped; usage and cost metered', async () => {
    const fetchImpl = okFetch(converseReply('You spent ₹4,200 on groceries this month.'));
    const r = await chatCompletion([
      { role: 'system', content: 'You are Pip.' },
      { role: 'user', content: 'How much on groceries?' },
      { role: 'user', content: 'This month.' },
    ], { config: nova(), readEnv: iamEnv(), fetchImpl, now: () => Date.parse('2026-10-16T09:00:00Z') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe('You spent ₹4,200 on groceries this month.');
    expect(r.provider).toBe('bedrock');
    expect(r.usage).toEqual({ promptTokens: 1200, completionTokens: 80, totalTokens: 1280 });
    expect(r.costUsd).toBe(0.000096);   // 1,200 × 0.063 + 80 × 0.252 per million, stored to 6 dp
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('https://bedrock-runtime.ap-southeast-2.amazonaws.com/model/amazon.nova-lite-v1%3A0/converse');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261016\/ap-southeast-2\/bedrock\/aws4_request, SignedHeaders=accept;content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(JSON.stringify(init)).not.toContain('wJalrXUtnFEMI');   // the secret key never travels
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ role: 'user', content: [{ text: 'How much on groceries?\n\nThis month.' }] }],
      system: [{ text: 'You are Pip.' }],
      inferenceConfig: { maxTokens: 600, temperature: 0.2 },
    });
    expect(buildUsageRow(r)).toMatchObject({ provider: 'bedrock', model: 'amazon.nova-lite-v1:0', prompt_tokens: 1200, outcome: 'ok' });
  });

  it('BEDROCK-CALL-002 · a Bedrock API key is sent as a bearer token', async () => {
    const fetchImpl = okFetch(converseReply('Hello from Vyact!'));
    const r = await chatCompletion([{ role: 'user', content: 'Hello' }], {
      config: nova({ key_env_var: 'AWS_BEARER_TOKEN_BEDROCK' }), readEnv: n => (n === 'AWS_BEARER_TOKEN_BEDROCK' ? 'bedrock-key-123' : ''), fetchImpl,
    });
    expect(r.ok && r.text).toBe('Hello from Vyact!');
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer bedrock-key-123');
  });

  it('BEDROCK-CALL-003 · a missing secret fails before any call, naming the variable, never a value', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await chatCompletion([{ role: 'user', content: 'hi' }], { config: nova(), readEnv: iamEnv({ AWS_SECRET_ACCESS_KEY: '' }), fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('missing_key');
    expect(r.message).toMatch(/AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(buildUsageRow(r)).toBeNull();   // nothing was attempted, nothing is metered
  });

  it('BEDROCK-CALL-004 · Bedrock errors come back as values with a useful hint, never the body', async () => {
    const denied = await chatCompletion([{ role: 'user', content: 'hi' }], {
      config: nova(), readEnv: iamEnv(),
      fetchImpl: okFetch({ message: 'You don\'t have access to the model with the specified model ID.' }, 403),
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied).toMatchObject({ code: 'http_error', status: 403 });
    expect(denied.hint).toMatch(/Enable Nova Lite under Model access/);
    expect(JSON.stringify(denied)).not.toContain('specified model ID');
    expect(bedrockErrorHint(400, 'Invocation of model ID amazon.nova-lite-v1:0 with on-demand throughput isn\'t supported'))
      .toMatch(/inference profile id/);
    const thrown = await chatCompletion([{ role: 'user', content: 'hi' }], {
      config: nova(), readEnv: iamEnv(), fetchImpl: vi.fn(async () => { throw new TypeError('network'); }) as unknown as typeof fetch,
    });
    expect(!thrown.ok && thrown.code).toBe('unreachable');
    expect(await chatCompletion([{ role: 'user', content: 'hi' }], { config: nova(), readEnv: iamEnv(), fetchImpl: okFetch({ nope: 1 }) }))
      .toMatchObject({ ok: false, code: 'bad_response' });
  });
});

describe('Converse mapping', () => {
  it('BEDROCK-MAP-001 · starts on a user turn, alternates, caps stops; parses text and usage', () => {
    const body = toConverseBody([
      { role: 'assistant', content: 'stray' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
      { role: 'assistant', content: 'c' }, { role: 'tool', content: 'd' },
    ], { maxTokens: 50, topP: 0.9, stop: ['END', '', 'X', 'Y', 'Z', 'W'] });
    expect(body).toEqual({
      messages: [
        { role: 'user', content: [{ text: 'a' }] },
        { role: 'assistant', content: [{ text: 'b\n\nc' }] },
        { role: 'user', content: [{ text: 'd' }] },
      ],
      inferenceConfig: { maxTokens: 50, topP: 0.9, stopSequences: ['END', 'X', 'Y', 'Z'] },
    });
    expect(toConverseBody([{ role: 'system', content: 'only system' }], { maxTokens: 10 })).toBeNull();
    expect(parseConverse({ output: { message: { content: [{ text: 'ab' }, { image: {} }, { text: 'cd' }] } } }, 3))
      .toEqual({ text: 'abc', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: null });
    expect(bedrockEndpoint('https://bedrock-runtime-fips.us-east-1.amazonaws.com/', 'us.amazon.nova-lite-v1:0'))
      .toMatchObject({ ok: true, region: 'us-east-1' });
  });
});
