import { vi } from 'vitest';

export function queryResult(data: unknown, error: unknown = null) {
  const query = { select: vi.fn(), eq: vi.fn(), neq: vi.fn(), gt: vi.fn(), order: vi.fn(), limit: vi.fn(),
    maybeSingle: vi.fn(), single: vi.fn(), update: vi.fn(), insert: vi.fn(), upsert: vi.fn(), delete: vi.fn(), in: vi.fn(), is: vi.fn(),
    then: (resolve: (result: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data, error }).then(resolve) };
  for (const value of Object.values(query)) if ('mockReturnValue' in value) value.mockReturnValue(query);
  return query;
}

export async function captureHandler(load: () => Promise<unknown>, overrides: Record<string, string> = {}) {
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const environment: Record<string, string> = { SUPABASE_URL: 'https://db.example.com',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', WHATSAPP_APP_SECRET: 'test-app-secret',
    WHATSAPP_ACCESS_TOKEN: 'test-meta-token', WHATSAPP_PHONE_NUMBER_ID: 'test-phone-id',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token', WHATSAPP_OTP_PEPPER: 'test-pepper', ...overrides };
  vi.stubGlobal('Deno', { env: { get: (key: string) => environment[key] },
    serve: (callback: typeof handler) => { handler = callback; } });
  vi.stubGlobal('EdgeRuntime', undefined);
  await load();
  if (!handler) throw new Error('Edge entrypoint did not register a handler');
  return handler;
}

export function userToken(id = 'user') {
  return `test.${btoa(JSON.stringify({ sub: id, role: 'authenticated' }))}.test`;
}