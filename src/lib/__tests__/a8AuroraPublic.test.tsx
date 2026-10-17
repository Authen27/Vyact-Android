// Aurora 4.0 · A8 public pages (v10.106.0) — LP1, LP2, LP3, LA1, LA2, AU1, AU2 and X1/X8 on the landing
// and sign-in screens. Each case is named after its change code.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import LandingView from '../../pages/LandingView';
import PasswordInput from '../../components/ui/PasswordInput';

vi.stubGlobal('React', React);
const src = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(src, p), 'utf8').replace(/\r\n/g, '\n');
const landing = () => renderToStaticMarkup(<MemoryRouter><LandingView cloudMode signedIn={false} /></MemoryRouter>);

describe('A8 · landing', () => {
  it('A8-LP1-001 · phones show Sign in and Open app; Learn stays in the footer and the lessons section', () => {
    const html = landing();
    const nav = /<nav[^>]*aria-label="Main"[^]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(nav).toMatch(/<a href="\/learn" class="hidden sm:inline /);
    expect(nav).toMatch(/href="\/auth\/sign-in"/);
    expect(nav).toMatch(/data-cta="nav"/);
    const footer = /<footer[^]*<\/footer>/.exec(html)?.[0] ?? '';
    expect(footer).toMatch(/<a href="\/learn" class="hover:text-ink">Learn<\/a>/);
  });

  it('A8-LP2-001 · the coral Pip band uses dark ink, never white text', () => {
    const s = read('pages/LandingView.tsx');
    const band = s.slice(s.indexOf('Pip spotlight'), s.indexOf('Insights showcase'));
    expect(band).not.toMatch(/text-white|white 88%|white 65%/);
    expect(band).toMatch(/style=\{\{ color: 'var\(--accent-ink\)' \}\} data-testid="landing-pip-band"/);
    expect(read('index.css')).toMatch(/--accent-ink: {2}#2A1712;/);
  });

  it('A8-LP3-001 · the Shorts are a swipe row of 150px tiles on phones, three across from sm', () => {
    const html = landing();
    expect(html).toMatch(/class="flex gap-3 overflow-x-auto snap-x snap-mandatory[^"]*sm:grid sm:grid-cols-3[^"]*" style="scrollbar-width:none" data-testid="landing-shorts"/);
    expect(html.match(/class="w-\[150px\] flex-shrink-0 snap-start sm:w-auto min-w-0"/g)).toHaveLength(3);
  });

  it('A8-LA1-X1-001 · landing cards are the raised 18px card; no old tiles, no mono caps, nothing under 11px', () => {
    const s = read('pages/LandingView.tsx');
    expect(s).toMatch(/const CARD = 'tile !rounded-r3';/);
    expect(s).not.toMatch(/bg-bg3 border border-line/);
    expect(s).not.toMatch(/font-mono/);
    expect(s).not.toMatch(/text-\[(?:[0-9]|10)(?:\.\d+)?px\]|text-\[0\.(?:[0-5]\d*|6[0-7]?)rem\]/);
    // The FAQ summary markup the FAQPage JSON-LD test pins is unchanged.
    expect(s).toMatch(/<summary className="text-\[0\.95rem\] font-semibold text-ink cursor-pointer">\{q\}<\/summary>/);
  });
});

describe('A8 · sign in', () => {
  it('A8-AU1-001 · Forgot? on the password label, the magic link as a ghost button, only Create account below', () => {
    const s = read('pages/auth/SignIn.tsx');
    expect(s).toMatch(/<label htmlFor="signin-password" className="ui-label">Password<\/label>\n\s*<Link to="\/auth\/reset-password"[^>]*>Forgot\?<\/Link>/);
    expect(s).toMatch(/<Button variant="ghost" full className="mt-2\.5"/);
    expect(s).toMatch(/Email me a sign-in link instead/);
    expect(s).not.toMatch(/Forgot password\?/);
    const footer = s.slice(s.indexOf('border-t border-line text-center'));
    expect(footer.slice(0, footer.indexOf('</div>'))).toMatch(/New here\?[^]*Create an account/);
  });

  it('A8-AU2-001 · a Show toggle inside the password field, labelled for the field Field names', () => {
    const html = renderToStaticMarkup(<PasswordInput id="pw" value="" onChange={() => {}} />);
    expect(html).toMatch(/<input[^>]*id="pw"[^>]*type="password"|<input[^>]*type="password"[^>]*id="pw"/);
    expect(html).toMatch(/aria-label="Show password"[^>]*>Show<\/button>/);
    expect(read('pages/auth/SignUp.tsx')).toMatch(/<PasswordInput autoComplete="new-password"/);
  });

  it('A8-LA2-001 · the auth card is 18px on phones, 26px from sm; auth screens use sans labels', () => {
    const s = read('pages/auth/SignIn.tsx');
    expect(s).toMatch(/className="rounded-r3 sm:rounded-r4 p-6 sm:p-7" data-testid="auth-card"/);
    expect(s).toMatch(/<div className="ui-pilot min-h-screen flex items-center justify-center/);
    for (const f of ['pages/auth/SignIn.tsx', 'pages/auth/SignUp.tsx', 'pages/auth/ResetPassword.tsx', 'pages/auth/AcceptInvite.tsx']) {
      expect(read(f), f).not.toMatch(/font-mono[^"`]*uppercase|text-\[0\.(?:[0-5]\d*|6[0-7]?)rem\]/);
    }
  });
});
