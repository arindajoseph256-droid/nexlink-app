import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';

import {
  clearChat,
  connectionState,
  deleteMessage,
  deleteMessageForMe,
  editMessage,
  getMessages,
  getOlderMessages,
  leaveGroup,
  markRead,
  pinMessage,
  sendMessage,
  sendAttachment,
  setConversationState,
  starMessage,
  toggleBlockUser,
  toggleReaction,
  getAuthToken,
} from '../api';
import { DaySeparator, MessageBubble, copyMessageText, downloadAttachment } from '../components/MessageBubble';
import { MessageComposer } from '../components/MessageComposer';
import { TypingIndicator } from '../components/TypingIndicator';
import { Avatar, ErrorText } from '../components/ui';
import { makeQueuedMessage, flushConversation, loadOutbox, removeQueuedForChat } from '../services/offlineQueue';
import { ManagedSocket } from '../services/websocket';
import { pickDocument, pickImage, startVoiceRecording, stopVoiceRecording } from '../services/media';
import { loadEnterToSend } from '../storage/settingsStorage';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError, isOfflineError } from '../utils/errors';
import { fmtDay } from '../utils/formatting';
import { peerOf } from '../utils/peerOf';

export function ChatScreen({ user }) {
  const route = useRoute();
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const conversation = route.params?.conversation;

  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  const [peer, setPeer] = useState(peerOf(conversation, user));
  const [online, setOnline] = useState(connectionState.online);
  const [queued, setQueued] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [enterToSend, setEnterToSend] = useState(true);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);

  const socketRef = useRef(null);
  const typingTimer = useRef(null);
  const mountedRef = useRef(true);

  const title = conversation.kind === 'group' ? conversation.name : peer?.display_name || 'Conversation';

  const sortMessages = useCallback((list) => {
    const seen = new Set();
    return list
      .filter((m) => {
        const key = m.client_id || `s${m.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      /* Inverted FlatList renders index 0 at the bottom: newest first. */
      .sort((a, b) => new Date(b.created_at || b.queued_at) - new Date(a.created_at || a.queued_at));
  }, []);

  /* initial load + mark read */
  useEffect(() => {
    mountedRef.current = true;
    getMessages(conversation.id)
      .then((data) => {
        if (!mountedRef.current) return;
        setMessages(sortMessages(data?.results || []));
        setHasMore(!!data?.has_more);
        markRead(conversation.id).catch(() => {});
      })
      .catch((err) => setError(friendlyError(err)));
    return () => {
      mountedRef.current = false;
    };
  }, [conversation.id, sortMessages]);

  /* composer behavior follows the chat settings preference (offline-safe) */
  useEffect(() => {
    loadEnterToSend().then((value) => {
      if (mountedRef.current) setEnterToSend(value);
    });
  }, []);

  /* offline queue count for this chat */
  const refreshQueue = useCallback(async () => {
    const pending = await loadOutbox();
    if (mountedRef.current) setQueued(pending.filter((item) => item.chatId === conversation.id));
  }, [conversation.id]);

  useEffect(() => {
    refreshQueue();
  }, [refreshQueue, online]);

  /* websocket with backoff via ManagedSocket */
  useEffect(() => {
    const socket = new ManagedSocket(`/ws/chat/${conversation.id}/`, {
      onOpen: () => {
        socket.send({ type: 'presence.ping' });
        flushConversation(
          conversation.id,
          async (item) =>
            item.attachment
              ? await sendAttachment(conversation.id, item.attachment.file || item.attachment, item.attachment.kind, item.text)
              : await sendMessage(conversation.id, item.text),
          (created) => {
            setMessages((current) => sortMessages([...current, created]));
            refreshQueue();
          },
        ).then(() => refreshQueue());
      },
      onEvent: (payload) => {
        if (!mountedRef.current) return;
        if (payload.type === 'message.new' && payload.message) {
          setMessages((current) => sortMessages([...current, payload.message]));
          markRead(conversation.id).catch(() => {});
        } else if (payload.type === 'message.edited' && payload.message) {
          setMessages((current) =>
            current.map((m) =>
              m.id === payload.message.id ? { ...m, body: payload.message.body, edited_at: payload.message.edited_at } : m,
            ),
          );
        } else if (payload.type === 'message.deleted' && payload.message_id) {
          setMessages((current) => current.map((m) => (m.id === payload.message_id ? { ...m, is_deleted: true } : m)));
        } else if (payload.type === 'reaction.updated' && payload.message_id) {
          setMessages((current) =>
            current.map((m) => {
              if (m.id !== payload.message_id) return m;
              const reactions = (m.reactions || []).map((r) => ({ ...r, users: [...(r.users || [])] }));
              const existing = reactions.find((r) => r.emoji === payload.emoji);
              if (payload.added) {
                if (existing) {
                  existing.count += 1;
                  existing.users.push(payload.user_id);
                } else {
                  reactions.push({ emoji: payload.emoji, count: 1, users: [payload.user_id] });
                }
              } else if (existing) {
                existing.count -= 1;
                existing.users = existing.users.filter((id) => id !== payload.user_id);
                if (existing.count <= 0) reactions.splice(reactions.indexOf(existing), 1);
              }
              return { ...m, reactions };
            }),
          );
        } else if (payload.type === 'typing.event') {
          if (payload.user_id && payload.user_id !== user.id) {
            setPeerTyping(!!payload.is_typing);
            if (payload.is_typing) {
              clearTimeout(typingTimer.current);
              typingTimer.current = setTimeout(() => setPeerTyping(false), 3000);
            }
          }
        } else if (payload.type === 'presence.event' && peer && payload.user_id === peer.id) {
          setPeer((current) => ({ ...current, is_online: payload.is_online }));
        } else if (payload.type === 'read.event' && payload.user_id !== user.id) {
          setMessages((current) =>
            current.map((m) => (m.sender?.id === user.id && m.state !== 'read' ? { ...m, state: 'read' } : m)),
          );
        }
      },
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      clearTimeout(typingTimer.current);
    };
  }, [conversation.id, user.id, peer?.id, sortMessages, refreshQueue]);

  useEffect(() => {
    const off = connectionState.subscribe((state) => setOnline(state.online));
    return off;
  }, []);

  async function loadOlder() {
    if (!hasMore || loadingOlder || !messages.length) return;
    setLoadingOlder(true);
    try {
      const oldest = [...messages].reverse().find((m) => m.id);
      if (!oldest) return;
      const data = await getOlderMessages(conversation.id, oldest.id);
      setMessages((current) => sortMessages([...(data?.results || []), ...current]));
      setHasMore(!!data?.has_more);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoadingOlder(false);
    }
  }

  function notifyTyping() {
    socketRef.current?.send({ type: 'typing', is_typing: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socketRef.current?.send({ type: 'typing', is_typing: false });
    }, 2000);
  }

  async function submit() {
    const text = body.trim();
    if (!text) return;
    setBody('');
    if (editing) {
      const target = editing;
      setEditing(null);
      try {
        const updated = await editMessage(target.id, text);
        setMessages((current) => current.map((m) => (m.id === updated.id ? updated : m)));
      } catch (err) {
        setError(friendlyError(err));
        setBody(text);
        setEditing(target);
      }
      return;
    }
    const activeReply = replyTo;
    setReplyTo(null);
    if (!online) {
      const item = makeQueuedMessage(conversation.id, text);
      const { enqueueMessage } = require('../services/offlineQueue');
      await enqueueMessage(item);
      refreshQueue();
      return;
    }
    try {
      const message = await sendMessage(conversation.id, text, activeReply?.id || null);
      setMessages((current) => sortMessages([...current, message]));
    } catch (err) {
      if (isOfflineError(err.message)) {
        const item = makeQueuedMessage(conversation.id, text);
        const { enqueueMessage } = require('../services/offlineQueue');
        await enqueueMessage(item);
        refreshQueue();
      } else {
        setError(friendlyError(err));
        setBody(text);
      }
    }
  }

  async function handlePick(result) {
    try {
      if (!online) {
        const { enqueueMessage } = require('../services/offlineQueue');
        await enqueueMessage(makeQueuedMessage(conversation.id, '', result));
        refreshQueue();
        return;
      }
      setBusy(true);
      try {
        const message = await sendAttachment(conversation.id, result.file, result.kind, '');
        setMessages((current) => sortMessages([...current, message]));
      } finally {
        setBusy(false);
      }
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  /* Same quick reactions as the web app (static/js/nexus.js). */
  const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];

  async function reactWith(message, emoji) {
    try {
      const res = await toggleReaction(message.id, emoji);
      setMessages((current) =>
        current.map((m) => {
          if (m.id !== message.id) return m;
          const reactions = (m.reactions || []).map((r) => ({ ...r, users: [...(r.users || [])] }));
          const existing = reactions.find((r) => r.emoji === emoji);
          if (res?.added) {
            if (existing) {
              existing.count += 1;
              existing.users.push(user.id);
            } else {
              reactions.push({ emoji, count: 1, users: [user.id] });
            }
          } else if (existing) {
            existing.count -= 1;
            existing.users = existing.users.filter((id) => id !== user.id);
            if (existing.count <= 0) reactions.splice(reactions.indexOf(existing), 1);
          }
          return { ...m, reactions };
        }),
      );
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  function reactionPicker(message) {
    const options = QUICK_REACTIONS.map((emoji) => ({
      text: emoji,
      onPress: () => reactWith(message, emoji),
    }));
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('React', undefined, options);
  }

  function handleAttachmentPress(message) {
    downloadAttachment(message);
  }

  async function runMessageAction(message, action) {
    try {
      if (action === 'react') reactionPicker(message);
      else if (action === 'star') {
        const res = await starMessage(message.id);
        setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, starred: res.starred } : m)));
      } else if (action === 'pin') {
        const res = await pinMessage(message.id);
        setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, pinned: res.pinned } : m)));
      } else if (action === 'copy') copyMessageText(message);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  function longPressMessage(message) {
    if (message.pending || message.is_deleted) return;
    const mine = message.sender?.id === user.id;
    const options = [
      { text: '❤️ React', onPress: () => runMessageAction(message, 'react') },
      { text: '↩ Reply', onPress: () => setReplyTo(message) },
      {
        text: message.starred ? '☆ Unstar' : '★ Star',
        onPress: () => runMessageAction(message, 'star'),
      },
      { text: message.pinned ? 'Unpin' : '📌 Pin', onPress: () => runMessageAction(message, 'pin') },
    ];
    if (message.body) options.push({ text: 'Copy', onPress: () => runMessageAction(message, 'copy') });
    if (message.attachment_url) {
      options.push({
        text: '⬇ Download',
        onPress: () => downloadAttachment(message),
      });
    }
    if (mine) {
      options.push(
        {
          text: '✎ Edit',
          onPress: () => {
            setEditing(message);
            setBody(message.body || '');
          },
        },
        {
          text: 'Delete for everyone',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMessage(message.id);
              setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, is_deleted: true } : m)));
            } catch (err) {
              setError(friendlyError(err));
            }
          },
        },
      );
    }
    options.push(
      {
        text: 'Delete for me',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMessageForMe(message.id);
            setMessages((current) => current.filter((m) => m.id !== message.id));
          } catch (err) {
            setError(friendlyError(err));
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    );
    Alert.alert(message.sender?.display_name || 'Message', undefined, options);
  }

  function chatMenu() {
    const items = [
      {
        text: conversation.pinned ? 'Unpin chat' : '📌 Pin chat',
        onPress: () => handleChatAction('pinned', !conversation.pinned),
      },
      { text: conversation.muted ? 'Unmute' : '🔇 Mute', onPress: () => handleChatAction('muted', !conversation.muted) },
      {
        text: conversation.archived ? 'Unarchive' : '🗄 Archive',
        onPress: () => handleChatAction('archived', !conversation.archived),
      },
      {
        text: '🧹 Clear my view',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearChat(conversation.id);
            await removeQueuedForChat(conversation.id);
            navigation.goBack();
          } catch (err) {
            setError(friendlyError(err));
          }
        },
      },
    ];
    if (conversation.kind === 'group') {
      items.push({
        text: 'Leave group',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveGroup(conversation.id);
            navigation.goBack();
          } catch (err) {
            setError(friendlyError(err));
          }
        },
      });
    } else if (peer) {
      items.push({
        text: 'Block user',
        style: 'destructive',
        onPress: async () => {
          try {
            await toggleBlockUser(peer.id, false);
            Alert.alert('Nexlink', 'User blocked. They can no longer message you.');
            navigation.goBack();
          } catch (err) {
            setError(friendlyError(err));
          }
        },
      });
    }
    items.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(title, undefined, items);
  }

  async function handleChatAction(action, value) {
    try {
      await setConversationState(conversation.id, { [action]: value });
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  /* Voice notes: real expo-audio recording → sendAttachment('audio', …). */
  const recordingRef = useRef(null);

  async function toggleRecording() {
    if (recordingRef.current) {
      // stop + send
      const active = recordingRef.current;
      recordingRef.current = null;
      setRecording(false);
      try {
        const result = await stopVoiceRecording(active.recorder);
        setBusy(true);
        try {
          const sent = await sendAttachment(conversation.id, result.file, result.kind, '');
          setMessages((current) => sortMessages([...current, sent]));
        } finally {
          setBusy(false);
        }
      } catch (err) {
        setError(friendlyError(err));
      }
      return;
    }
    try {
      const session = await startVoiceRecording();
      recordingRef.current = session;
      setRecording(true);
    } catch (err) {
      Alert.alert('Voice note', friendlyError(err));
    }
  }

  const styles = makeStyles(colors, accent);
  const renderRow = ({ item, index }) => {
    const prev = messages[index - 1];
    const mine = item.sender?.id === user.id || item.pending;
    const showDay =
      !prev ||
      new Date(prev.created_at || prev.queued_at).toDateString() !==
        new Date(item.created_at || item.queued_at).toDateString();
    const showSender = conversation.kind === 'group' && !mine && (!prev || prev.sender?.id !== item.sender?.id);
    return (
      <View>
        {showDay && <DaySeparator iso={item.created_at || item.queued_at} />}
        <MessageBubble
          message={item}
          isMine={mine}
          showSender={showSender}
          onLongPress={longPressMessage}
          onPressAttachment={handleAttachmentPress}
          onPressReaction={(message, emoji) => reactWith(message, emoji)}
          user={user}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Avatar
          name={title}
          color={conversation.kind === 'group' ? '#f6c86b' : null}
          uri={peer?.avatar_url}
          size={38}
          online={conversation.kind === 'dm' ? peer?.is_online : null}
        />
        <View style={styles.chatMeta}>
          <Text style={[styles.chatTitle, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.status, { color: colors.muted }]}>
            {peerTyping
              ? 'typing…'
              : conversation.kind === 'group'
                ? `${conversation.participants?.length || 0} members`
                : peer?.is_online
                  ? 'online'
                  : peer?.last_seen
                    ? `last seen ${fmtDay(peer.last_seen)}`
                    : 'offline'}
          </Text>
        </View>
        <TouchableOpacity style={styles.backButton} onPress={chatMenu}>
          <Text style={{ color: colors.text, fontSize: 20 }}>⋮</Text>
        </TouchableOpacity>
      </View>

      {!online && (
        <View style={[styles.offlineBar, { backgroundColor: colors.warning }]}>
          <Text style={{ color: '#071d22', fontSize: 12.5, fontWeight: '600' }}>
            You're offline — messages will send when you're back online.
          </Text>
        </View>
      )}
      <ErrorText message={error} />

      {(replyTo || editing) && (
        <View style={[styles.replyBar, { backgroundColor: colors.surfaceAlt }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.replyName, { color: accent }]}>
              {editing ? 'Editing message' : `Reply to ${replyTo?.sender?.display_name || 'message'}`}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
              {editing ? editing.body : replyTo?.body || replyTo?.attachment_name || 'Attachment'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              setReplyTo(null);
              setEditing(null);
              setBody('');
            }}
          >
            <Text style={{ color: colors.text, fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={[...queued, ...messages]}
        keyExtractor={(item, i) => String(item.id ?? item.client_id ?? i)}
        renderItem={renderRow}
        inverted
        contentContainerStyle={styles.messageList}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.6}
        ListFooterComponent={hasMore && loadingOlder ? <ActivityIndicator style={{ margin: 10 }} color={accent} /> : null}
        ListEmptyComponent={<Text style={styles.empty}>Say hello 👋</Text>}
      />

      <TypingIndicator visible={peerTyping} name={peer?.display_name} />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <MessageComposer
        value={body}
        onChangeText={(text) => {
          setBody(text);
          notifyTyping();
        }}
        onSubmit={submit}
        onPick={handlePick}
        recording={recording}
        uploading={busy}
        onToggleRecording={toggleRecording}
        enterToSend={enterToSend}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors, accent) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.chatBg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: colors.panel,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: 8,
    },
    backButton: { paddingHorizontal: 6 },
    backText: { fontSize: 22 },
    chatMeta: { flex: 1 },
    chatTitle: { fontSize: 16, fontWeight: '700' },
    status: { fontSize: 12 },
    offlineBar: { paddingVertical: 6, paddingHorizontal: 14 },
    replyBar: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 12,
      marginTop: 6,
      padding: 10,
      borderRadius: 12,
    },
    replyName: { fontSize: 12.5, fontWeight: '700' },
    messageList: { paddingVertical: 12 },
    empty: { color: colors.muted, textAlign: 'center', marginTop: 30 },
    errorText: { color: colors.danger, fontSize: 12.5, paddingHorizontal: 16, paddingVertical: 4 },
  });
}
