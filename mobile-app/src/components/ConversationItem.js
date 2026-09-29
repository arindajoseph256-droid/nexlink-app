import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Avatar } from './ui';
import { useTheme } from '../theme/ThemeProvider';
import { fmtTime } from '../utils/formatting';
import { peerOf } from '../utils/peerOf';

export function ConversationItem({ conversation, currentUser, onOpen, onChatState }) {
  const { colors } = useTheme();
  const peer = peerOf(conversation, currentUser);
  const name = conversation.kind === 'group' ? conversation.name : peer?.display_name || 'Conversation';
  const last = conversation.last_message;
  const preview = last?.is_deleted
    ? 'Message deleted'
    : last?.body || (last?.attachment_name ? `📎 ${last.attachment_name}` : 'No messages yet');

  function longPress() {
    Alert.alert(
      name,
      undefined,
      [
        {
          text: conversation.pinned ? '📌 Unpin chat' : '📌 Pin chat',
          onPress: () => onChatState(conversation, 'pinned', !conversation.pinned),
        },
        {
          text: conversation.muted ? '🔇 Unmute' : '🔇 Mute',
          onPress: () => onChatState(conversation, 'muted', !conversation.muted),
        },
        {
          text: conversation.archived ? '📤 Unarchive' : '🗄 Archive',
          onPress: () => onChatState(conversation, 'archived', !conversation.archived),
        },
        { text: '🧹 Clear my view', style: 'destructive', onPress: () => onChatState(conversation, 'clear') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  return (
    <TouchableOpacity style={[styles.row, { backgroundColor: colors.bg }]} onPress={() => onOpen(conversation)} onLongPress={longPress}>
      <Avatar
        name={name}
        color={conversation.kind === 'group' ? '#f6c86b' : null}
        uri={conversation.kind === 'group' ? null : peer?.avatar_url}
        size={46}
        online={conversation.kind === 'dm' ? peer?.is_online : null}
      />
      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.time, { color: colors.muted }]}>{last ? fmtTime(last.created_at) : ''}</Text>
        </View>
        <View style={styles.line}>
          <Text style={[styles.preview, { color: colors.muted }]} numberOfLines={1}>
            {preview}
          </Text>
          {conversation.muted ? <Text style={styles.flag}>🔇</Text> : null}
          {conversation.pinned ? <Text style={styles.flag}>📌</Text> : null}
          {conversation.unread_count > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={styles.badgeText}>{conversation.unread_count}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  body: { flex: 1, marginLeft: 12 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 15.5, fontWeight: '600', flexShrink: 1, marginRight: 8 },
  time: { fontSize: 11.5 },
  preview: { fontSize: 13.5, flexShrink: 1, marginRight: 6 },
  flag: { fontSize: 12, marginLeft: 6 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, marginLeft: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
});
