import React, { useCallback, useContext, useEffect, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getNotifications, markNotificationsRead } from '../api';
import { Avatar, LoadingState } from './ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { fmtDay, fmtTime } from '../utils/formatting';

const KIND_ICON = {
  message: '💬',
  reaction: '❤️',
  system: '⚙️',
};

function relative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return fmtTime(iso);
  return fmtDay(iso);
}

/**
 * Real notifications list — GET /api/notifications/ (results + unread count),
 * POST /api/notifications/read/ (mark all or one read). Tapping an item with
 * a conversation opens that chat and marks the notification read.
 */
export function NotificationsModal({ visible, onClose, onOpenConversation }) {
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [markingRead, setMarkingRead] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNotifications();
      setItems(Array.isArray(data?.results) ? data.results : []);
      setError('');
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  async function markAllRead() {
    setMarkingRead(true);
    try {
      await markNotificationsRead();
      setItems((current) => current.map((item) => ({ ...item, is_read: true })));
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setMarkingRead(false);
    }
  }

  async function openItem(item) {
    if (!item.is_read) {
      markNotificationsRead(item.id).catch(() => {});
      setItems((current) => current.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)));
    }
    onClose();
    if (item.conversation_id && onOpenConversation) {
      onOpenConversation(item.conversation_id);
    }
  }

  const unreadCount = items.filter((item) => !item.is_read).length;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.page, { backgroundColor: colors.bg }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.back, { color: accent }]}>{'‹ Back'}</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Notifications</Text>
          <TouchableOpacity
            onPress={markAllRead}
            disabled={markingRead || unreadCount === 0}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text
              style={[
                styles.markAll,
                { color: unreadCount === 0 || markingRead ? colors.muted : accent },
              ]}
            >
              Mark all read
            </Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

        {loading ? (
          <LoadingState label="Loading notifications…" />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.muted }]}>
                No notifications yet. Messages and reactions will show up here.
              </Text>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.row, { backgroundColor: colors.surface }, !item.is_read && styles.unread]}
                onPress={() => openItem(item)}
                activeOpacity={0.7}
              >
                <Avatar name={item.actor || '?'} size={38} />
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <Text style={[styles.rowText, { color: colors.text }]} numberOfLines={2}>
                      {KIND_ICON[item.kind] || '🔔'} {item.text}
                    </Text>
                    <Text style={[styles.rowTime, { color: colors.muted }]}>{relative(item.created_at)}</Text>
                  </View>
                  {!item.is_read ? <View style={[styles.dot, { backgroundColor: accent }]} /> : null}
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { fontSize: 16, fontWeight: '700' },
  title: { fontSize: 16, fontWeight: '800' },
  markAll: { fontSize: 13, fontWeight: '600' },
  error: { fontSize: 12.5, paddingHorizontal: 16, paddingVertical: 6 },
  list: { paddingBottom: 24 },
  empty: { textAlign: 'center', marginTop: 48, marginHorizontal: 32, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 14,
    padding: 12,
  },
  unread: { borderLeftWidth: 3 },
  rowBody: { flex: 1, marginLeft: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowText: { flex: 1, fontSize: 14, lineHeight: 19 },
  rowTime: { fontSize: 11 },
  dot: { width: 8, height: 8, borderRadius: 4, alignSelf: 'flex-end', marginTop: 6 },
});
