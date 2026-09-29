/**
 * Sync service: coordinates refresh + reconnect when the app returns to the
 * foreground and after connectivity drops, so missed data is fetched without
 * the user restarting the app.
 */
import { AppState } from 'react-native';

const listeners = new Set();

export function onForegroundSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startSyncService() {
  let previous = AppState.currentState;
  const subscription = AppState.addEventListener('change', (state) => {
    if (previous.match(/inactive|background/) && state === 'active') {
      listeners.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
    }
    previous = state;
  });
  return () => subscription.remove();
}
