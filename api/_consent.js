// Vyact — Google Analytics, asked first (v10.125.0, T4b; audit XC-PRV-03; owner, 19 Oct 2026:
// "Ask first, off until yes for the web app; the mobile app has it on through its app permissions").
//
// ONE script for every page that can count: the app and its landing page (index.html, injected at build
// time by vite.config.ts's `vyact-analytics` hook, so the prerendered landing has it too) and the public
// Learn / for / about pages (api/_page.js). It used to load GA4 for every visitor on vyact.app, while the
// Cookie Policy said analytics ran only where you opt in.
//
//   • GA runs only on the real site (vyact.app / www.vyact.app) or inside the Android app (Capacitor).
//     localhost, CI, Vercel previews, stage/dev and admin never count (v10.49.0).
//   • Google Consent Mode v2 starts DENIED for everything; ads storage, ads data and ad personalisation
//     stay denied always.
//   • On the web (a browser or the installed PWA) nothing reaches Google until the visitor chooses
//     Allow on the banner (or in Settings). The choice is kept on the device (`vt_analytics_consent`,
//     shared by the app and the Learn pages: same site) and can be changed in Settings and on the
//     Cookie Policy. "No thanks" clears Google's cookies.
//   • In the Android app, analytics is part of the app's own permissions (Play listing and data
//     safety form), so it starts without the banner and Settings shows it as set by the app.
//   • page_location is REDACTED (W0, XC-PRV-02): no invite token in the path, no email / token / code /
//     next in the query. The fragment (Supabase auth tokens) is never sent.
//   • Events go to Google only once analytics is on (`window.__vyGaOn`); nothing queued before is
//     replayed, because gtag.js is never loaded before consent.
// The script is plain ES5 so it runs before the app bundle on every browser Vyact supports.

export const GA_ID = 'G-E3XKWZP850';
export const CONSENT_KEY = 'vt_analytics_consent';

const SCRIPT = `
(function () {
  var KEY = '${CONSENT_KEY}', ID = '${GA_ID}', h = location.hostname;
  var nat = false;
  try { nat = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { nat = false; }
  var site = nat || h === 'vyact.app' || h === 'www.vyact.app';
  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* the choice lasts this visit */ } }
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.__vyGaOn = false;
  if (site) window.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  function cleanLocation() {
    var path = location.pathname.replace(/^\\/invite\\/[^/]+/, '/invite/:token');
    var q = new URLSearchParams(location.search);
    ['email', 'token', 'code', 'next', 'access_token', 'refresh_token', 'token_hash'].forEach(function (k) { q.delete(k); });
    var qs = q.toString();
    return location.origin + path + (qs ? '?' + qs : '');
  }
  var plat = nat ? 'android-app' : (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ? 'pwa' : 'web';
  var started = false, loaded = false;
  function load() { if (loaded) return; loaded = true; var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID; document.head.appendChild(s); }
  function idle() { if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 3000 }); else window.setTimeout(load, 1500); }
  function start() {
    if (!site || window.__vyGaOn) return;
    window.__vyGaOn = true;
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    if (!started) { started = true; window.gtag('js', new Date()); window.gtag('config', ID, { page_location: cleanLocation() }); }
    if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle, { once: true });
  }
  function stop() {
    window.__vyGaOn = false;
    if (site) window.gtag('consent', 'update', { analytics_storage: 'denied' });
    var c = (document.cookie || '').split(';');
    for (var i = 0; i < c.length; i++) {
      var name = c[i].split('=')[0].replace(/^\\s+/, '');
      if (/^_ga/.test(name)) {
        document.cookie = name + '=; Max-Age=0; path=/';
        document.cookie = name + '=; Max-Age=0; path=/; domain=.' + h.replace(/^www\\./, '');
      }
    }
  }
  var bar = null;
  function hide() { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); bar = null; }
  function choose(v) { write(v); hide(); if (v === 'granted') start(); else stop(); }
  function show() {
    if (bar || !document.body) return;
    bar = document.createElement('div');
    bar.id = 'vy-analytics-consent';
    bar.className = 'bottom-above-tabbar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Analytics choice');
    bar.style.cssText = 'position:fixed;left:12px;right:12px;z-index:70;max-width:560px;margin:0 auto;padding:14px 16px;'
      + 'border-radius:18px;background:var(--elevated,#fff);color:hsl(var(--ink,0 0% 10%));box-shadow:0 8px 28px rgba(0,0,0,.18);'
      + 'font:14px/1.45 Inter,system-ui,sans-serif;';
    var p = document.createElement('p');
    p.style.cssText = 'margin:0 0 10px;';
    p.appendChild(document.createTextNode('May Vyact use Google Analytics to count how its pages are used? It never sees the money you record. '));
    var a = document.createElement('a');
    a.href = '/cookies'; a.textContent = 'Cookie Policy';
    a.style.cssText = 'color:inherit;text-decoration:underline;';
    p.appendChild(a);
    bar.appendChild(p);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';
    function button(label, primary, v) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = 'min-height:44px;padding:0 16px;border-radius:12px;border:0;cursor:pointer;font:inherit;font-weight:600;'
        + (primary ? 'background:var(--accent,#e8735a);color:var(--accent-ink,#1a1a1a);' : 'background:transparent;color:inherit;');
      b.addEventListener('click', function () { choose(v); });
      return b;
    }
    row.appendChild(button('No thanks', false, 'denied'));
    row.appendChild(button('Allow analytics', true, 'granted'));
    bar.appendChild(row);
    document.body.appendChild(bar);
  }
  window.vyTrack = function (n, p) { if (window.__vyGaOn) { var o = p || {}; o.platform = plat; window.gtag('event', n, o); } };
  window.__vyAnalytics = {
    site: site,
    native: nat,
    choice: function () { return nat ? 'granted' : read(); },
    allow: function () { if (!nat) choose('granted'); },
    decline: function () { if (!nat) choose('denied'); },
  };
  if (!site) return;
  if (nat || read() === 'granted') { start(); return; }
  if (read() === 'denied') return;
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
})();
`;

/** The script element every counting page carries (index.html and the public pages). */
export function analyticsSnippet() {
  return `<script>${SCRIPT}</script>`;
}
