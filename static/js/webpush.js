/* ==========================================================================
   NEXLINK — webpush.js
   Real OS push notifications for browsers/PWA via the Web Push protocol.

   - Registers /service-worker.js (must be root scope).
   - Asks the backend for the VAPID applicationServerKey.
   - Creates a PushSubscription and stores it with /api/auth/push/subscribe/.

   Permission is requested ONLY from a real user gesture (clicking
   "Enable notifications" in Settings, or the prompt button) — never on
   page load, which browsers block and users hate. On load we only sync
   silently when permission was already granted.
   ========================================================================== */

window.NexlinkPush = (function () {
    'use strict';

    var API = window.PulseAPI;
    var STORE_KEY = 'nexlink.push.endpoint';

    var lastGesture = 0;
    document.addEventListener('pointerdown', function () { lastGesture = Date.now(); }, { capture: true, passive: true });

    function supported() {
        return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    }

    function secure() {
        return window.location.protocol === 'https:' ||
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1';
    }

    function urlBase64ToUint8Array(base64String) {
        var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        var raw = window.atob(base64);
        var output = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
        return output;
    }

    function registerServiceWorker() {
        return navigator.serviceWorker.register('/service-worker.js');
    }

    function rememberSubscription(sub) {
        try { localStorage.setItem(STORE_KEY, sub.endpoint); } catch (e) { /* private mode */ }
    }

    function forgetSubscription() {
        try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    }

    /* Interactive enable: safe to prompt for permission (call from click). */
    function enable() {
        if (!supported() || !secure()) return Promise.resolve(false);
        if (window.Notification.permission === 'denied') return Promise.resolve(false);

        var ask;
        if (window.Notification.permission === 'default') {
            // Called synchronously inside the click task so the browser
            // still counts the user gesture.
            ask = window.Notification.requestPermission();
        } else {
            ask = Promise.resolve(window.Notification.permission);
        }

        return ask.then(function (permission) {
            if (permission !== 'granted') return false;
            return API.get('/api/auth/push/config/').then(function (cfg) {
                if (!cfg || !cfg.public_key) return false;
                return registerServiceWorker().then(function (reg) {
                    return reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(cfg.public_key),
                    });
                });
            }).then(function (sub) {
                var json = sub.toJSON ? sub.toJSON() : sub;
                return API.post('/api/auth/push/subscribe/', { subscription: json })
                    .then(function () { rememberSubscription(json); return true; });
            });
        }).catch(function () { return false; });
    }

    /* Silent sync on page load: only acts when permission is already
       granted — never prompts. Also re-posts an existing subscription so
       the server's user mapping stays fresh after re-login. */
    function sync() {
        if (!supported() || !secure()) return Promise.resolve(false);
        if (window.Notification.permission !== 'granted') return Promise.resolve(false);
        return API.get('/api/auth/push/config/').then(function (cfg) {
            if (!cfg || !cfg.public_key) return false;
            return registerServiceWorker().then(function (reg) {
                return reg.pushManager.getSubscription().then(function (existing) {
                    if (existing) {
                        var json = existing.toJSON ? existing.toJSON() : existing;
                        return API.post('/api/auth/push/subscribe/', { subscription: json })
                            .then(function () { rememberSubscription(json); return true; });
                    }
                    return reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(cfg.public_key),
                    }).then(function (sub) {
                        var created = sub.toJSON ? sub.toJSON() : sub;
                        return API.post('/api/auth/push/subscribe/', { subscription: created })
                            .then(function () { rememberSubscription(created); return true; });
                    });
                });
            });
        }).catch(function () { return false; });
    }

    /* Turn notifications off: unsubscribe everywhere. */
    function disable() {
        if (!supported()) { forgetSubscription(); return Promise.resolve(); }
        var endpoint = null;
        try { endpoint = localStorage.getItem(STORE_KEY); } catch (e) { /* ignore */ }
        return registerServiceWorker().then(function (reg) {
            return reg.pushManager.getSubscription();
        }).then(function (sub) {
            if (endpoint && (!sub || !sub.endpoint)) {
                return API.post('/api/auth/push/unsubscribe/', { endpoint: endpoint }).catch(function () {});
            }
            if (!sub) return undefined;
            var json = sub.toJSON ? sub.toJSON() : sub;
            return API.post('/api/auth/push/unsubscribe/', { endpoint: json.endpoint }).catch(function () {})
                .then(function () { return sub.unsubscribe(); });
        }).then(function () {
            forgetSubscription();
        }).catch(function () { forgetSubscription(); });
    }

    function status() {
        if (!supported()) return 'unsupported';
        if (!secure()) return 'insecure';
        return window.Notification.permission; // 'granted' | 'denied' | 'default'
    }

    return {
        enable: enable,
        sync: sync,
        disable: disable,
        status: status,
        supported: supported,
    };
})();
