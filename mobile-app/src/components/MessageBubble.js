import React from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AuthenticatedImage } from './AuthenticatedImage';
import { useTheme } from '../theme/ThemeProvider';
import { fmtBytes, fmtDay, fmtTime } from '../utils/formatting';

let ExpoClipboard = null;
try {
  ExpoClipboard = require('expo-clipboard');
} catch {}
let ExpoAudio = null;
try {
  ExpoAudio = require('expo-audio');
} catch {}
let FileSystem = null;
let Sharing = null;
try {
  FileSystem = require('expo-file-system');
} catch {}
try {
  Sharing = require('expo-sharing');
} catch {}

function tick(state, pending, colors) {
  if (pending) return '◷';
  if (state === 'read') return '✓✓';
  if (state === 'delivered') return '✓✓';
  if (state === 'sent') return '✓';
  return '';
}

function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Download via authenticated GET, then open the Android share sheet. */
export async function downloadAttachment(message, onProgress) {
  const url = message?.attachment_url;
  if (!url) return;
  const name = message.attachment_name || 'attachment';
  if (!FileSystem || !FileSystem.createDownloadResumable) {
    // Module unavailable → open in the system browser (URL carries ?token=).
    await Linking.openURL(url);
    return;
  }
  const { getAuthToken, API_BASE_URL } = require('../api');
  const token = getAuthToken();
  let base = url;
  if (base.startsWith('/')) base = `${API_BASE_URL}${base}`;
  const separator = base.includes('?') ? '&' : '?';
  const authenticatedUrl = token ? `${base}${separator}token=${encodeURIComponent(token)}` : base;
  const target = `${FileSystem.cacheDirectory}${name.replace(/\s+/g, '_')}`;
  try {
    onProgress?.(0);
    const { uri } = await FileSystem.createDownloadResumable(
      authenticatedUrl,
      target,
      {},
      (progress) => onProgress?.(progress.totalBytesExpected ? progress.totalBytesWritten / progress.totalBytesExpected : 0),
    ).downloadAsync();
    onProgress?.(1);
    if (Sharing && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(uri, { mimeType: message.attachment_mime_type || '*/*', dialogTitle: name });
    } else {
      Alert.alert('Downloaded', `Saved to app storage: ${name}`);
    }
  } catch (error) {
    onProgress?.(null);
    Alert.alert('Download failed', String(error?.message || 'Could not download the file. Try again.'));
  }
}

/** Real audio playback for voice notes via expo-audio (SDK 57 hook API). */
function AudioBubble({ uri, colors }) {
  const { getAuthToken, API_BASE_URL } = require('../api');
  const token = getAuthToken();
  let resolved = uri || '';
  if (resolved.startsWith('/')) resolved = `${API_BASE_URL}${resolved}`;
  // Native players can send headers — prefer the header over a ?token= URL.
  const player = ExpoAudio.useAudioPlayer(
    token ? { uri: resolved, headers: { Authorization: `Token ${token}` } } : resolved,
  );
  const status = ExpoAudio.useAudioPlayerStatus(player);
  const playing = Boolean(status?.playing);
  return (
    <View style={styles.audioRow}>
      <TouchableOpacity
        onPress={() => (playing ? player.pause() : player.play())}
        style={[styles.audioButton, { backgroundColor: colors.accent }]}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
      >
        <Text style={styles.audioIcon}>{playing ? '⏸' : '▶'}</Text>
      </TouchableOpacity>
      <Text style={[styles.audioTime, { color: colors.text }]}>
        {fmtDuration(status?.currentTime || 0)} / {fmtDuration(status?.duration || 0)}
      </Text>
    </View>
  );
}

export function MessageBubble({ message, isMine, showSender, onLongPress, onPressAttachment, onPressReaction, user }) {
  const { colors, accent, withAlpha } = useTheme();
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
              <Pressable onPress={() => onPressAttachment?.(message)}>
                <AuthenticatedImage
                  uri={message.attachment_url}
                  style={styles.attachImage}
                  resizeMode="cover"
                />
              </Pressable>
            )}
            {message.attachment_url && message.message_type === 'video' && (
              <TouchableOpacity
                style={[styles.attachFile, { backgroundColor: withAlpha(0.12) }]}
                onPress={() => onPressAttachment?.(message)}
              >
                <Text style={[styles.attachName, { color: colors.text }]}>🎬 {message.attachment_name || 'Video'}</Text>
                <Text style={[styles.attachSize, { color: colors.muted }]}>
                  {fmtBytes(message.attachment_size)} · tap to open
                </Text>
              </TouchableOpacity>
            )}
            {message.attachment_url && message.message_type === 'audio' && (
              ExpoAudio ? (
                <AudioBubble uri={message.attachment_url} colors={colors} />
              ) : (
                <TouchableOpacity onPress={() => onPressAttachment?.(message)}>
                  <Text style={{ color: colors.text }}>🎙 {message.attachment_name || 'Voice message'}</Text>
                </TouchableOpacity>
              )
            )}
            {message.attachment_url && !['image', 'video', 'audio'].includes(message.message_type) && (
              <TouchableOpacity
                style={[styles.attachFile, { backgroundColor: withAlpha(0.12) }]}
                onPress={() => onPressAttachment?.(message)}
              >
                <Text style={[styles.attachName, { color: colors.text }]} numberOfLines={1}>
                  📄 {message.attachment_name || 'Attachment'}
                </Text>
                <Text style={[styles.attachSize, { color: colors.muted }]}>
                  {fmtBytes(message.attachment_size)} · tap to download
                </Text>
              </TouchableOpacity>
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
          {reactions.map((r) => {
            const mineReaction = Array.isArray(r.users) && r.users.includes(user?.id);
            return (
              <TouchableOpacity
                key={r.emoji}
                style={[
                  styles.reactionPill,
                  { backgroundColor: colors.surfaceAlt },
                  mineReaction && { backgroundColor: accent, borderColor: accent, borderWidth: 1 },
                ]}
                onPress={() => onPressReaction?.(message, r.emoji)}
                accessibilityRole="button"
                accessibilityLabel={`${r.emoji} ${r.count} reactions`}
              >
                <Text style={{ fontSize: 12 }}>{r.emoji}</Text>
                <Text style={[styles.reactionCount, { color: colors.muted }]}>{r.count}</Text>
              </TouchableOpacity>
            );
          })}
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

export async function copyMessageText(message) {
  const text = message?.body || '';
  if (!text) return;
  try {
    if (ExpoClipboard?.setStringAsync) {
      await ExpoClipboard.setStringAsync(text);
    } else if (Platform.OS === 'web' && navigator?.clipboard) {
      await navigator.clipboard.writeText(text);
    }
    Alert.alert('Copied', 'Message text copied.');
  } catch {}
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
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  audioButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  audioIcon: { color: '#071d22', fontSize: 15, fontWeight: '800' },
  audioTime: { fontSize: 12.5, fontVariant: ['tabular-nums'] },
  body: { fontSize: 15, lineHeight: 20 },
  meta: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 2 },
  time: { fontSize: 10.5 },
  reactions: { flexDirection: 'row', marginHorizontal: 8, marginTop: -6, marginBottom: 4, gap: 4 },
  reactionPill: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  reactionCount: { fontSize: 11, marginLeft: 4, fontWeight: '600' },
  dayRow: { alignItems: 'center', marginVertical: 10 },
  dayText: { fontSize: 11.5, fontWeight: '700', overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999 },
});
