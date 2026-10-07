/* MarketX service worker: push notifications only (no caching, so every deploy loads fresh). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

const ICON = '/brand/marketx-logo-192.png?v=3';
const BADGE = '/brand/marketx-badge-96.png?v=1';
// Safari / iOS revoke a subscription after a push that shows nothing, so Apple devices always get the notification
const APPLE = /iPhone|iPad|Macintosh/.test(self.navigator.userAgent) && !/Chrome|CriOS|Android/.test(self.navigator.userAgent);

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'MarketX', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'MarketX';
  // Only this site's own paths (never //host or \\host, which browsers read as another site)
  const url = typeof data.url === 'string' && /^\/(?![\/\\])/.test(data.url) ? data.url : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // MarketX open and in front: it shows the notice itself (toast + chime), so no second popup
      const visible = list.find(c => c.visibilityState === 'visible' && c.focused);
      list.forEach(c => c.postMessage({ type: 'mx-push', kind: data.kind || '' }));
      if (visible && !APPLE) return;
      return self.registration.showNotification(title, {
        body: data.body || '',
        icon: ICON,
        badge: BADGE,
        tag: data.tag || undefined,
        renotify: !!data.tag,
        vibrate: [60, 40, 90],
        data: { url },
      });
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
      const target = new URL(url, self.location.origin).href;
      for (const c of list) {
        if (new URL(c.url).origin !== self.location.origin) continue;
        await c.focus();
        // The open page routes the link itself (same as a tap on an in-app notification)
        c.postMessage({ type: 'mx-open', url });
        return;
      }
      return self.clients.openWindow(target);
    })
  );
});
