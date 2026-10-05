/**
 * WebSocket service for the Nexlink Android client.
 *
 * Two endpoints (same as the web app):
 *   /ws/notifications/   — per-user room: conversation updates everywhere
 *   /ws/chat/<id>/       — per-conversation: messages, typing, receipts
 *
 * Features: exponential backoff reconnection, duplicate-connection guard,
 * foreground refresh callbacks, token auth via ?token=<key>.
 */
import { WS_BASE_URL } from '../api/config';
import { connectionState, getAuthToken } from '../api/client';

const MAX_BACKOFF_MS = 15000;
// Presence heartbeat: keeps the server's is_online flag fresh. Without it,
// a killed app (no graceful disconnect) leaves the user marked online
// forever and the server then suppresses push notifications.
const PING_INTERVAL_MS = 45000;

class ManagedSocket {
  /**
   * @param {string} path  e.g. '/ws/notifications/' or '/ws/chat/12/'
   * @param {object} handlers { onEvent(payload), onOpen(), onClose() }
   */
  constructor(path, handlers = {}) {
    this.path = path;
    this.handlers = handlers;
    this.socket = null;
    this.attempt = 0;
    this.closedByUser = false;
    this.retryTimer = null;
    this.reconnecting = false;
  }

  connect() {
    if (this.socket) return; // duplicate-connection guard
    const token = getAuthToken();
    if (!token) return;
    this.closedByUser = false;
    this.stopPing();

    let socket;
    try {
      socket = new WebSocket(`${WS_BASE_URL}${this.path}?token=${encodeURIComponent(token)}`);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.reconnecting = false;
      connectionState.set({ socket: true });
      this.startPing();
      this.handlers.onOpen?.();
    };

    socket.onmessage = (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handlers.onEvent?.(payload);
    };

    socket.onclose = () => {
      this.stopPing();
      this.socket = null;
      connectionState.set({ socket: false });
      if (this.closedByUser) return;
      this.scheduleRetry();
      this.handlers.onClose?.();
    };

    socket.onerror = () => {};
  }

  scheduleRetry() {
    if (this.closedByUser || this.reconnecting) return;
    this.reconnecting = true;
    const delay = Math.min(500 * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.reconnecting = false;
      this.connect();
    }, delay);
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'presence.ping' });
    }, PING_INTERVAL_MS);
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  send(payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  /** Force reconnect (foreground resume, token change). Resets backoff. */
  reconnectNow() {
    this.attempt = 0;
    if (this.socket) {
      this.closedByUser = true;
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
      this.closedByUser = false;
    }
    clearTimeout(this.retryTimer);
    this.reconnecting = false;
    this.connect();
  }

  close() {
    this.closedByUser = true;
    this.stopPing();
    clearTimeout(this.retryTimer);
    this.reconnecting = false;
    try {
      this.socket?.close();
    } catch {}
    this.socket = null;
    connectionState.set({ socket: false });
  }
}

/** Shared per-user notifications socket (one per app, survives screen changes). */
let sharedUserSocket = null;

export function ensureUserSocket(onEvent) {
  if (sharedUserSocket) {
    if (onEvent) sharedUserSocket.handlers.onEvent = onEvent;
    if (!sharedUserSocket.socket) sharedUserSocket.reconnectNow();
    return sharedUserSocket;
  }
  sharedUserSocket = new ManagedSocket('/ws/notifications/', { onEvent });
  sharedUserSocket.connect();
  return sharedUserSocket;
}

export function resetUserSocket() {
  if (sharedUserSocket) {
    sharedUserSocket.close();
    sharedUserSocket = null;
  }
}

export { ManagedSocket };
