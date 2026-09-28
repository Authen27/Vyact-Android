/* Vyact — push handler for the service worker (v10.48.0, TD-22).
 *
 * Imported into the Workbox-generated service worker (vite.config.ts →
 * workbox.importScripts). The `web-push` Edge Function sends an encrypted JSON
 * payload { title, body, url, tag, type }; the browser decrypts it and hands it here.
 * Every push MUST show a notification: Safari and Chrome revoke a subscription whose
 * pushes are silently dropped.
 */
/* global self, URL */

function safeUrl(u) {
  return typeof u === 'string' && u.charAt(0) === '/' && u.charAt(1) !== '/' ? u : '/';
}

self.addEventListener('push', function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
  var title = d.title || 'Vyact';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: d.tag || undefined,
    data: { url: safeUrl(d.url) },
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = new URL(safeUrl(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (wins) {
    for (var i = 0; i < wins.length; i++) {
      var w = wins[i];
      if ('focus' in w) {
        return w.focus().then(function (focused) {
          return focused && 'navigate' in focused ? focused.navigate(target).catch(function () { return focused; }) : focused;
        });
      }
    }
    return self.clients.openWindow(target);
  }));
});

// The app asks before subscribing: an older worker without this file would drop pushes.
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'VYACT_PUSH_PING' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ type: 'VYACT_PUSH_PONG', version: 1 });
  }
});
