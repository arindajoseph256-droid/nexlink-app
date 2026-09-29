/**
 * Lightweight realtime event bus.
 *
 * App-level subscribers (badges, toasts, notifications modal) listen for
 * events from the shared /ws/notifications/ socket without re-fetching the
 * whole world. The single onEvent handler in App.js fans out here; screens
 * subscribe with onRealtimeEvent(...) and unsubscribe with the returned
 * function (re-validate subscriptions on focus).
 */
const subscribers = new Set();

export function emitRealtimeEvent(event) {
  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch {}
  }
}

/** Returns an unsubscribe function. */
export function onRealtimeEvent(handler) {
  subscribers.add(handler);
  return () => subscribers.delete(handler);
}

export function subscriberCount() {
  return subscribers.size;
}
