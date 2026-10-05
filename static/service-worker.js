/* ==========================================================================
   NEXLINK — service-worker.js
   Progressive Web App shell caching.

   Strategy:
   - App shell (login + static assets): stale-while-revalidate.
   - /health/ and /static/: cache-first for instant offline startup.
   - Authenticated pages and /api/ traffic are NEVER cached — private
     conversations must not persist in shared storage (rule 42).
   - Push notification click focuses or opens the right conversation.
   ========================================================================== */

const VERSION = 'nexlink-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;

const SHELL_ASSETS = [
    '/static/manifest.json',
    '/static/images/icon-192.png',
    '/static/images/icon-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) =>
                // Cache each asset individually so one hiccup cannot break
                // installation. Pages (login/dashboard) are cached at
                // runtime by the navigation handler — never prefetched,
                // because addAll rejects on redirected responses.
                Promise.all(
                    SHELL_ASSETS.map((url) =>
                        cache.add(url).catch(() => {/* best-effort */})
                    )
                )
            )
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => !key.startsWith(VERSION))
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (event.request.method !== 'GET') return;

    // Never cache private or dynamic content.
    if (url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/media/') ||
        url.pathname.startsWith('/accounts/users/')) {
        return;
    }

    // Static assets: cache-first (hashed by Django's manifest storage).
    if (url.pathname.startsWith('/static/')) {
        event.respondWith(
            caches.open(STATIC_CACHE).then(async (cache) => {
                const hit = await cache.match(event.request);
                if (hit) return hit;
                try {
                    const response = await fetch(event.request);
                    if (response.ok) cache.put(event.request, response.clone());
                    return response;
                } catch (err) {
                    return hit || Response.error();
                }
            })
        );
        return;
    }

    // Health endpoint: cheap cache-first for offline status checks.
    if (url.pathname === '/health/') {
        event.respondWith(
            caches.open(SHELL_CACHE).then(async (cache) => {
                const hit = await cache.match(event.request);
                if (hit) return hit;
                try {
                    const response = await fetch(event.request);
                    if (response.ok) cache.put(event.request, response.clone());
                    return response;
                } catch (err) {
                    return hit || new Response(JSON.stringify({ status: 'offline' }), {
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
            })
        );
        return;
    }

    // Navigations (login, dashboard): network-first so users get fresh
    // pages when online, falling back to the cached shell offline.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            (async () => {
                try {
                    const response = await fetch(event.request);
                    if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
                        const cache = await caches.open(SHELL_CACHE);
                        cache.put(event.request, response.clone());
                    }
                    return response;
                } catch (err) {
                    const cache = await caches.open(SHELL_CACHE);
                    const cachedPage = await cache.match(event.request);
                    if (cachedPage) return cachedPage;
                    return new Response('<h1>Nexlink is offline</h1><p>Reconnect to continue.</p>', {
                        headers: { 'Content-Type': 'text/html' },
                        status: 503,
                    });
                }
            })()
        );
    }
});

self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (err) {
        data = { title: 'Nexlink', body: event.data ? event.data.text() : '' };
    }
    const title = data.title || 'Nexlink';
    const payload = data.data || {};
    const conversationId = payload.conversation_id;
    const isCall = payload.kind === 'call';
    const url = conversationId ? `/chats/?c=${conversationId}` : '/';
    // One notification per conversation: a newer message replaces the
    // previous one for that chat (WhatsApp-style stacking) instead of
    // flooding the notification tray.
    const tag = isCall ? `nexlink-call-${payload.call_id || 'x'}`
        : (conversationId ? `nexlink-conv-${conversationId}` : 'nexlink-message');

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // A focused Nexlink tab already shows the in-app banner —
                // no OS notification needed.
                if (clientList.some((client) => client.focused)) return undefined;
                return self.registration.showNotification(title, {
                    body: data.body || 'You have a new message.',
                    icon: '/static/images/icon-192.png',
                    badge: '/static/images/icon-192.png',
                    tag: tag,
                    renotify: true,
                    data: { url: url, kind: payload.kind || 'message' },
                });
            })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                for (const client of clientList) {
                    if ('focus' in client) {
                        client.navigate(target);
                        return client.focus();
                    }
                }
                return self.clients.openWindow(target);
            })
    );
});
