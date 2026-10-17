// SHA-256 as lowercase hex, via Web Crypto (v10.53.0). Used to send GA4 a stable,
// non-reversible user_id instead of the raw internal id (master to-do #55).
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
