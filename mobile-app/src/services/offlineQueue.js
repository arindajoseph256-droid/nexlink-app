/**
 * Persistent offline outbox. Messages composed while offline are queued in
 * SecureStore and flushed when connectivity returns. Each item carries a
 * client_id so retried flushes never duplicate messages.
 */
import * as SecureStore from 'expo-secure-store';

const OUTBOX_KEY = 'nexlink.outbox.v1';

export async function loadOutbox() {
  try {
    const raw = await SecureStore.getItemAsync(OUTBOX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveOutbox(items) {
  try {
    await SecureStore.setItemAsync(OUTBOX_KEY, JSON.stringify(items));
  } catch {}
}

export function makeQueuedMessage(chatId, text, attachment = null) {
  return {
    chatId,
    text,
    attachment,
    client_id: `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    queued_at: new Date().toISOString(),
    pending: true,
  };
}

export async function enqueueMessage(item) {
  const pending = await loadOutbox();
  if (pending.some((existing) => existing.client_id === item.client_id)) return;
  await saveOutbox([...pending, item]);
}

/**
 * Flush every queued item for one conversation, in order.
 * Returns remaining count (0 when everything sent).
 */
export async function flushConversation(chatId, sendFn, onSent) {
  let pending = await loadOutbox();
  const mine = pending.filter((item) => item.chatId === chatId);
  if (!mine.length) return 0;

  pending = pending.filter((item) => item.chatId !== chatId);
  await saveOutbox(pending);

  for (const item of mine) {
    try {
      const created = await sendFn(item);
      onSent?.(created);
    } catch (error) {
      // Put the unsent item (and anything after it) back, preserving order.
      const index = mine.indexOf(item);
      const restored = [...(await loadOutbox()), ...mine.slice(index)];
      await saveOutbox(restored);
      return restored.filter((entry) => entry.chatId === chatId).length;
    }
  }
  return 0;
}

export async function removeQueuedForChat(chatId) {
  const pending = await loadOutbox();
  await saveOutbox(pending.filter((item) => item.chatId !== chatId));
}
