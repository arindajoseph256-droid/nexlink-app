/* ==========================================================================
   NEXLINK — socket.js
   WebSocket wrappers (per-conversation chat + per-user notifications)
   with exponential-backoff reconnect and a shared pub/sub registry.
   ========================================================================== */

window.PulseSocket = (function () {
    'use strict';

    var listeners = {};

    function createSocket(config) {
        /* config: { url(conversationId|conversationId), onOpen, isChat } */
        var state = {
            socket: null,
            conversationId: null,
            reconnectDelay: 500,
            reconnectTimer: null,
            closedByUser: false,
            pingTimer: null,
        };

        function buildUrl() {
            var scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
            if (config.isChat) {
                return scheme + '://' + window.location.host +
                    '/ws/chat/' + state.conversationId + '/';
            }
            return scheme + '://' + window.location.host + '/ws/notifications/';
        }

        function open(conversationId, onOpen) {
            state.conversationId = conversationId;
            state.closedByUser = false;
            clearTimeout(state.reconnectTimer);
            close();

            state.socket = new WebSocket(buildUrl());

            state.socket.onopen = function () {
                state.reconnectDelay = 500; // reset backoff after healthy connect
                startPing();
                if (onOpen) onOpen();
                emit({ type: 'socket.connected', channel: config.name });
            };

            state.socket.onmessage = function (event) {
                var data;
                try {
                    data = JSON.parse(event.data);
                } catch (err) {
                    return;
                }
                emit(data);
            };

            state.socket.onclose = function () {
                stopPing();
                if (state.closedByUser) return;
                // Server rejects unauthorized/non-member sockets by closing
                // immediately; reconnect with backoff so transient drops
                // recover but hard denials stay low-frequency.
                emit({ type: 'socket.disconnected', channel: config.name });
                state.reconnectTimer = setTimeout(function () {
                    state.reconnectDelay = Math.min(state.reconnectDelay * 2, 10000);
                    open(state.conversationId, null);
                }, state.reconnectDelay);
            };

            state.socket.onerror = function () {
                // onclose fires next; reconnect logic lives there.
            };
        }

        function close() {
            if (state.socket) {
                state.socket.onclose = null; // suppress reconnect for this close
                state.closedByUser = true;
                state.socket.close();
                state.socket = null;
            }
            clearTimeout(state.reconnectTimer);
            stopPing();
        }

        function send(payload) {
            if (state.socket && state.socket.readyState === WebSocket.OPEN) {
                state.socket.send(JSON.stringify(payload));
                return true;
            }
            return false;
        }

        function startPing() {
            stopPing();
            state.pingTimer = setInterval(function () {
                send({ type: 'presence.ping' });
            }, 45000);
        }

        function stopPing() {
            clearInterval(state.pingTimer);
        }

        return {
            open: open,
            close: close,
            send: send,
        };
    }

    function emit(payload) {
        (listeners[payload.type] || []).forEach(function (fn) {
            try {
                fn(payload);
            } catch (err) {
                console.error('socket handler error', err);
            }
        });
    }

    function on(type, handler) {
        (listeners[type] = listeners[type] || []).push(handler);
        return function off() {
            listeners[type] = listeners[type].filter(function (fn) { return fn !== handler; });
        };
    }

    var chat = createSocket({ name: 'chat', isChat: true });
    var user = createSocket({ name: 'user', isChat: false });

    return {
        connect: chat.open,          // (conversationId, onOpen)
        close: chat.close,
        send: chat.send,
        connectUser: user.open,      // () — notifications socket
        closeUser: user.close,
        sendUser: user.send,
        on: on,
    };
})();
