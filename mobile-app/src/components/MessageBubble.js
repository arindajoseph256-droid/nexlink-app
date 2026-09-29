import React from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fmtBytes, fmtDay, fmtTime } from '../utils/formatting';

function tick(state, pending, colors) {
  if (pending) return '◷';
  if (state === 'read') return '✓✓';
  if (state === 'delivered') return '✓✓';
  if (state === 'sent') return '✓';
  return '';
}

export function MessageBubble({ message, isMine, showSender, onLongPress }) {
  const { colors, withAlpha } = useTheme();
  const reactions = Array.isArray(message.reactions)
    ? message.reactions.filter((r) => r && r.count > 0)
    : [];
  const mine = isMine || message.pending;

  return (
    <View style={styles.wrap}>
      {showSender && <Text style={[styles.sender, { color: colors.accent }]}>{message.sender?.display_name}</Text>}
      <Pressable
        onLongPress={message.pending || message.is_deleted ? undefined : () => onLongPress?.(message)}
        style={[
          styles.bubble,
          mine ? { backgroundColor: colors.bubbleOut, alignSelf: 'flex-end' } : { backgroundColor: colors.bubbleIn, alignSelf: 'flex-start' },
        ]}
      >
        {message.pinned ? <Text style={styles.flag}>📌</Text> : null}
        {message.is_deleted ? (
          <Text style={[styles.body, { color: colors.muted, fontStyle: 'italic' }]}>🚫 Message deleted</Text>
        ) : (
          <>
            {message.reply_to && (
              <View style={[styles.replyBox, { borderLeftColor: colors.accent }]}>
                <Text style={[styles.replyName, { color: colors.accent }]}>{message.reply_to.sender_name}</Text>
                <Text style={[styles.replyBody, { color: colors.muted }]} numberOfLines={2}>
                  {message.reply_to.is_deleted ? 'Message deleted' : message.reply_to.body || 'Attachment'}
                </Text>
              </View>
            )}
            {message.attachment_url && message.message_type === 'image' && (
              <Image source={{ uri: message.attachment_url }} style={styles.attachImage} />
            )}
            {message.attachment_url && message.message_type === 'video' && (
              <View style={[styles.attachFile, { backgroundColor: withAlpha(0.12) }]}>
                <Text style={[styles.attachName, { color: colors.text }]}>🎬 {message.attachment_name || 'Video'}</Text>
                <Text style={[styles.attachSize, { color: colors.muted }]}>{fmtBytes(message.attachment_size)}</Text>
              </View>
            )}
            {message.attachment_url && message.message_type === 'audio' && (
              <Text style={{ color: colors.text }}>🎙 Voice message</Text>
            )}
            {message.attachment_url && !['image', 'video', 'audio'].includes(message.message_type) && (
              <View style={[styles.attachFile, { backgroundColor: withAlpha(0.12) }]}>
                <Text style={[styles.attachName, { color: colors.text }]} numberOfLines={1}>
                  📄 {message.attachment_name || 'Attachment'}
                </Text>
                <Text style={[styles.attachSize, { color: colors.muted }]}>{fmtBytes(message.attachment_size)}</Text>
              </View>
            )}
            {message.body && message.body.trim() ? (
              <Text style={[styles.body, { color: mine ? colors.bubbleOutText : colors.text }]}>
                {message.body}
                {message.edited_at ? ' (edited)' : ''}
              </Text>
            ) : null}
          </>
        )}
        <View style={styles.meta}>
          <Text style={[styles.time, { color: colors.muted }]}>{fmtTime(message.created_at || message.queued_at)}</Text>
          {message.starred ? <Text style={styles.flag}>★</Text> : null}
          {mine ? (
            <Text style={{ color: message.state === 'read' ? colors.tickRead : colors.muted, fontSize: 11, marginLeft: 4 }}>
              {tick(message.state, message.pending)}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {reactions.length > 0 && (
        <View style={[styles.reactions, mine ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
          {reactions.map((r) => (
            <View key={r.emoji} style={[styles.reactionPill, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={{ fontSize: 12 }}>{r.emoji}</Text>
              <Text style={[styles.reactionCount, { color: colors.muted }]}>{r.count}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function DaySeparator({ iso }) {
  const { colors } = useTheme();
  return (
    <View style={styles.dayRow}>
      <Text style={[styles.dayText, { color: colors.muted, backgroundColor: colors.chatBg }]}>{fmtDay(iso)}</Text>
    </View>
  );
}

export function copyMessageText(message) {
  const text = message?.body || '';
  if (!text) return;
  if (Platform.OS === 'web' && navigator?.clipboard) {
    navigator.clipboard.writeText(text);
  } else {
    Alert.alert('Copied', 'Message text copied.');
  }
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 10, marginVertical: 3, maxWidth: '86%' },
  sender: { fontSize: 12, fontWeight: '700', marginLeft: 12, marginBottom: 2 },
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  flag: { fontSize: 11, color: '#f6c86b', marginBottom: 2 },
  replyBox: { borderLeftWidth: 3, paddingLeft: 8, paddingVertical: 4, marginBottom: 6, borderRadius: 4 },
  replyName: { fontSize: 12, fontWeight: '700' },
  replyBody: { fontSize: 12, marginTop: 1 },
  attachImage: { width: 220, height: 220, borderRadius: 12, marginBottom: 6 },
  attachFile: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6 },
  attachName: { fontSize: 13, fontWeight: '600' },
  attachSize: { fontSize: 11, marginTop: 2 },
  body: { fontSize: 15, lineHeight: 20 },
  meta: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 2 },
  time: { fontSize: 10.5 },
  reactions: { flexDirection: 'row', marginHorizontal: 8, marginTop: -6, marginBottom: 4, gap: 4 },
  reactionPill: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  reactionCount: { fontSize: 11, marginLeft: 4, fontWeight: '600' },
  dayRow: { alignItems: 'center', marginVertical: 10 },
  dayText: { fontSize: 11.5, fontWeight: '700', overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999 },
});
