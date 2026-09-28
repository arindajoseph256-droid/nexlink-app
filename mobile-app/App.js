import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  createGroup,
  connectionState,
  getChatPeople,
  getConversations,
  getMessages,
  getOlderMessages,
  getAuthToken,
  loadAuthToken,
  login,
  logout,
  markRead,
  register,
  registerPushToken,
  searchUsers,
  sendMessage,
  sendAttachment,
  setAuthToken,
  startConversation,
  startConversationByPhone,
  unregisterPushToken,
  getMe,
  updateProfile,
  updatePreferences,
  WS_BASE_URL,
} from './api';

/* Optional Expo modules — all degrade gracefully when unavailable. */
let SecureStore = null;
try { SecureStore = require('expo-secure-store'); } catch {}
let ImagePicker = null;
try { ImagePicker = require('expo-image-picker'); } catch {}
let DocumentPicker = null;
try { DocumentPicker = require('expo-document-picker'); } catch {}
let Notifications = null;
try { Notifications = require('expo-notifications'); } catch {}
let ExpoAv = null;
try { ExpoAv = require('expo-av'); } catch {}

const nexlinkIcon = require('./assets/icon.png');

const OUTBOX_KEY = 'nexlink.outbox.v1';

const colors = {
  bg: '#f4f6fb',
  panel: '#ffffff',
  surface: '#ffffff',
  surfaceAlt: '#eef4f1',
  surfaceSoft: '#f8f9fc',
  border: '#dfe7e3',
  text: '#0c2329',
  muted: '#5f7a74',
  primary: '#00a884',
  primaryStrong: '#008069',
  primarySoft: '#e2f6ef',
  accent: '#74ffd6',
  success: '#22c55e',
  successSoft: '#e9f9ef',
  danger: '#ef4444',
  dangerSoft: '#fdecec',
  warning: '#f59e0b',
  darkText: '#071d22',
  welcomeBg: '#071d22',
  welcomeText: '#f2fffb',
  welcomeAccent: '#74ffd6',
};

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '?';
}

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDay(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function fmtBytes(b) {
  b = Number(b || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function Brand() {
  return (
    <View style={styles.brandRow}>
      <Image source={nexlinkIcon} style={styles.brandIcon} />
      <Text style={styles.brandText}>NEXLINK</Text>
    </View>
  );
}

function ErrorText({ message }) {
  if (!message) return null;
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function Avatar({ name, color = colors.primary, uri, size = 40, online }) {
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return (
      <View style={{ width: size, height: size }}>
        <Image source={{ uri }} style={style} />
        {online != null && (
          <View style={[styles.presenceDot, online && styles.presenceOn, { right: 0, bottom: 0, width: size / 4, height: size / 4 }]} />
        )}
      </View>
    );
  }
  return (
    <View style={[style, styles.avatar, { backgroundColor: color }]}>
      <Text style={[styles.avatarText, { fontSize: Math.max(10, size / 3) }]}>{initials(name)}</Text>
      {online != null && (
        <View style={[styles.presenceDot, online && styles.presenceOn, { right: 0, bottom: 0, width: size / 4, height: size / 4 }]} />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Outbox (offline queue) — survives restarts via SecureStore.        */
/* ------------------------------------------------------------------ */
async function loadOutbox() {
  if (SecureStore) {
    try {
      const raw = await SecureStore.getItemAsync(OUTBOX_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {}
  }
  return [];
}

async function saveOutbox(items) {
  if (SecureStore) {
    try { await SecureStore.setItemAsync(OUTBOX_KEY, JSON.stringify(items)); } catch {}
  }
}

/* ------------------------------------------------------------------ */
/* Auth                                                               */
/* ------------------------------------------------------------------ */
function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [identifier, setIdentifier] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [about, setAbout] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    setBusy(true);
    try {
      let data;
      if (mode === 'login') {
        data = await login(identifier, password);
      } else {
        data = await register({
          full_name: fullName,
          email,
          phone_number: identifier,
          password,
          confirm_password: password,
          about,
        });
      }
      onAuthenticated(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.authPage}>
      <ScrollView contentContainerStyle={styles.authPageInner} keyboardShouldPersistTaps="handled">
        <View style={styles.welcomePanel}>
          <View style={styles.welcomeTopline}>
            <View style={styles.welcomeMark}><Text style={styles.welcomeMarkText}>N</Text></View>
            <Text style={styles.welcomeBrand}>NEXLINK</Text>
          </View>
          <View style={styles.welcomeContent}>
            <Text style={styles.welcomeEyebrow}>Private messaging</Text>
            <Text style={styles.heroTitle}>Say hello to everyone.</Text>
            <Text style={styles.welcomeLead}>
              One account for every screen — phone, tablet and desktop. Messages stay in sync, instantly.
            </Text>
            <View style={styles.welcomeSignal}>
              <View style={styles.signalDot} />
              <Text style={styles.signalText}>REAL-TIME · SECURE · FREE</Text>
              <View style={styles.signalLine} />
            </View>
          </View>
          <View style={styles.visualGlow} />
          <View style={styles.visualOut} />
          <Text style={styles.welcomeFooter}>NEXLINK — CONNECT EVERYWHERE</Text>
        </View>

        <View style={styles.authCard}>
          <View style={styles.authBrand}>
            <View style={styles.authBrandLogo}><Text style={styles.authBrandLogoText}>N</Text></View>
            <Text style={styles.authBrandText}>{mode === 'login' ? 'WELCOME BACK' : 'CREATE ACCOUNT'}</Text>
          </View>
          <Text style={styles.cardTitle}>{mode === 'login' ? 'Log in' : 'Join Nexlink'}</Text>
          <Text style={styles.cardSubtitle}>
            {mode === 'login' ? 'Use your phone number or email.' : 'A few details and you are in.'}
          </Text>

          {mode === 'register' && (
            <View style={styles.field}>
              <Text style={styles.label}>Full name</Text>
              <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="Jane Doe" placeholderTextColor={colors.muted} />
            </View>
          )}
          <View style={styles.field}>
            <Text style={styles.label}>{mode === 'login' ? 'Phone or email' : 'Phone number'}</Text>
            <TextInput
              style={styles.input}
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="+256 7XX XXX XXX"
              placeholderTextColor={colors.muted}
              keyboardType={mode === 'login' ? 'email-address' : 'phone-pad'}
              autoCapitalize="none"
            />
          </View>
          {mode === 'register' && (
            <View style={styles.field}>
              <Text style={styles.label}>Email (optional)</Text>
              <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.muted} autoCapitalize="none" />
            </View>
          )}
          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.muted} />
          </View>
          {mode === 'register' && (
            <View style={styles.field}>
              <Text style={styles.label}>About you (optional)</Text>
              <TextInput style={styles.input} value={about} onChangeText={setAbout} placeholder="Available on Nexlink" placeholderTextColor={colors.muted} />
            </View>
          )}

          <ErrorText message={error} />

          <TouchableOpacity style={styles.primaryButton} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.darkText} /> : <Text style={styles.primaryButtonText}>{mode === 'login' ? 'Log in' : 'Create account'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            <Text style={styles.switchText}>
              {mode === 'login' ? 'New to Nexlink? Create an account' : 'Already have an account? Log in'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/* Conversation list                                                  */
/* ------------------------------------------------------------------ */
function ConversationList({
  user, conversations, onOpen, onLogout, onProfile, searchResults,
  onStart, onGroup, onPhoneChat, isWide, connOnline,
}) {
  const [query, setQuery] = useState('');

  function onChange(text) {
    setQuery(text);
    onSearch(text);
  }

  const phoneCandidate = useMemo(() => {
    const digits = query.replace(/[^\d+]/g, '');
    return digits.length >= 7 ? digits : null;
  }, [query]);

  return (
    <SafeAreaView style={[styles.appShell, isWide && styles.sidebarPane]}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.sidebarHeader}>
        <TouchableOpacity style={styles.profileRow} onPress={onProfile}>
          <Avatar name={user?.display_name} color={colors.accent} uri={user?.avatar_url} size={38} />
          <View>
            <Text style={styles.profileName}>{user?.display_name || 'NEXLINK'}</Text>
            <Text style={[styles.connText, connOnline ? styles.connOn : styles.connOff]}>
              {connOnline ? 'connected' : 'offline'}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={onGroup}>
          <Text style={styles.iconText}>◎</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchArea}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search name, phone, email..."
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={onChange}
        />
      </View>

      {searchResults.length > 0 && (
        <View style={styles.searchResults}>
          <Text style={styles.sectionTitle}>People</Text>
          {searchResults.map((person) => (
            <TouchableOpacity key={person.id} style={styles.searchPerson} onPress={() => onStart(person.id)}>
              <Avatar name={person.display_name} color={colors.primaryStrong} uri={person.avatar_url} size={34} online={person.is_online} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{person.display_name}</Text>
                {person.masked_phone ? <Text style={styles.sub}>{person.masked_phone}</Text> : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!searchResults.length && phoneCandidate && (
        <TouchableOpacity style={styles.phoneChatRow} onPress={() => onPhoneChat(phoneCandidate)}>
          <Text style={styles.phoneChatText}>Chat with {phoneCandidate}</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.sectionTitle}>Conversations</Text>

      <FlatList
        data={conversations}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No conversations yet. Search for someone to start chatting.</Text>}
        renderItem={({ item }) => {
          const peer = item.kind === 'group' ? null : item.participants?.find((person) => person.id !== user?.id);
          const name = item.kind === 'group' ? item.name : peer?.display_name || 'Conversation';
          const last = item.last_message;
          const preview = last?.is_deleted ? 'Message deleted' : (last?.body || (last?.attachment_name ? `📎 ${last.attachment_name}` : 'No messages yet'));

          return (
            <TouchableOpacity style={styles.conversation} onPress={() => onOpen(item)}>
              <Avatar name={name} color={item.kind === 'group' ? '#f6c86b' : '#7dd3fc'} uri={item.kind === 'group' ? null : peer?.avatar_url} size={44} online={item.kind === 'dm' ? peer?.is_online : null} />
              <View style={styles.conversationBody}>
                <View style={styles.row}>
                  <Text style={styles.name} numberOfLines={1}>{name}</Text>
                  <Text style={styles.time}>{last ? fmtTime(last.created_at) : ''}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.preview} numberOfLines={1}>{preview}</Text>
                  {item.muted ? <Text style={styles.mutedIcon}>🔇</Text> : null}
                  {item.pinned ? <Text style={styles.mutedIcon}>📌</Text> : null}
                  {item.unread_count > 0 && (
                    <View style={styles.unread}>
                      <Text style={styles.unreadText}>{item.unread_count}</Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <TouchableOpacity style={styles.logout} onPress={onLogout}>
        <Text style={styles.footerLink}>Log out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/* Voice note playback                                                */
/* ------------------------------------------------------------------ */
function VoiceNote({ uri }) {
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef(null);

  async function toggle() {
    if (!ExpoAv) return;
    const { Audio } = ExpoAv;
    try {
      if (!soundRef.current) {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync({ uri });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.didJustFinish) { setPlaying(false); sound.setPositionAsync(0); }
        });
      }
      if (playing) { await soundRef.current.pauseAsync(); setPlaying(false); }
      else { await soundRef.current.playAsync(); setPlaying(true); }
    } catch {}
  }

  useEffect(() => () => { if (soundRef.current) soundRef.current.unloadAsync(); }, []);

  return (
    <TouchableOpacity style={styles.voiceRow} onPress={toggle}>
      <Text style={styles.voiceIcon}>{playing ? '⏸' : '▶'}</Text>
      <Text style={styles.voiceLabel}>Voice message</Text>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* Chat screen                                                        */
/* ------------------------------------------------------------------ */
function ChatScreen({ user, conversation, onBack, isWide, onConversationsChanged }) {
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  const [peer, setPeer] = useState(
    conversation.kind === 'group' ? null : conversation.participants?.find((person) => person.id !== user.id) || null,
  );
  const [recording, setRecording] = useState(null);
  const [connOnline, setConnOnline] = useState(true);
  const [queue, setQueue] = useState([]);
  const socketRef = useRef(null);
  const retryRef = useRef(0);
  const retryTimer = useRef(null);
  const typingTimer = useRef(null);
  const closedRef = useRef(false);
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

  /* initial load */
  useEffect(() => {
    let mounted = true;
    setError('');
    setMessages([]);
    setHasMore(false);
    getMessages(conversation.id)
      .then((data) => {
        if (!mounted) return;
        setMessages(sortMessages(data?.results || []));
        setHasMore(!!data?.has_more);
        markRead(conversation.id).catch(() => {});
        onConversationsChanged?.();
      })
      .catch((err) => setError(err.message));
    return () => { mounted = false; };
  }, [conversation.id]);

  /* connection awareness */
  useEffect(() => {
    const off = connectionState.subscribe((state) => setConnOnline(state.online));
    return off;
  }, []);

  /* outbox flush when online */
  const flushQueue = useCallback(async () => {
    if (!getAuthToken()) return;
    let pending = await loadOutbox();
    const mine = pending.filter((item) => item.chatId === conversation.id);
    if (!mine.length) return;
    pending = pending.filter((item) => item.chatId !== conversation.id);
    await saveOutbox(pending);
    setQueue([]);
    for (const item of mine) {
      try {
        const created = item.attachment
          ? await sendAttachment(conversation.id, item.attachment, item.attachment.kind, item.text)
          : await sendMessage(conversation.id, item.text);
        setMessages((current) => sortMessages([...current, created]));
        onConversationsChanged?.();
      } catch {
        const restored = [...(await loadOutbox()), item];
        await saveOutbox(restored);
        setQueue((current) => [...current, item]);
        break;
      }
    }
  }, [conversation.id]);

  useEffect(() => { flushQueue(); }, [connOnline]);

  /* websocket with backoff */
  const connectSocket = useCallback(() => {
    if (closedRef.current || !getAuthToken()) return;
    const socket = new WebSocket(`${WS_BASE_URL}/ws/chat/${conversation.id}/?token=${encodeURIComponent(getAuthToken() || '')}`);
    socketRef.current = socket;

    socket.onopen = () => {
      retryRef.current = 0;
      connectionState.set({ socket: true });
      socket.send(JSON.stringify({ type: 'presence.ping' }));
      flushQueue();
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'message.new' && payload.message) {
          setMessages((current) => sortMessages([...current, payload.message]));
          markRead(conversation.id).catch(() => {});
          onConversationsChanged?.();
        } else if (payload.type === 'message.edited' && payload.message) {
          setMessages((current) => current.map((m) => (m.id === payload.message.id ? { ...m, body: payload.message.body, edited_at: payload.message.edited_at } : m)));
        } else if (payload.type === 'message.deleted' && payload.message_id) {
          setMessages((current) => current.map((m) => (m.id === payload.message_id ? { ...m, is_deleted: true } : m)));
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
          setMessages((current) => current.map((m) => (m.sender?.id === user.id && m.state !== 'read' ? { ...m, state: 'read' } : m)));
        }
      } catch {}
    };

    socket.onclose = () => {
      connectionState.set({ socket: false });
      if (closedRef.current) return;
      const delay = Math.min(500 * 2 ** retryRef.current, 10000);
      retryRef.current += 1;
      retryTimer.current = setTimeout(connectSocket, delay);
    };
    socket.onerror = () => {};
  }, [conversation.id, peer?.id, flushQueue]);

  useEffect(() => {
    closedRef.current = false;
    connectSocket();
    return () => {
      closedRef.current = true;
      clearTimeout(retryTimer.current);
      clearTimeout(typingTimer.current);
      if (socketRef.current) socketRef.current.close();
      connectionState.set({ socket: false });
    };
  }, [connectSocket]);

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
      setError(err.message);
    } finally {
      setLoadingOlder(false);
    }
  }

  function notifyTyping() {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'typing', is_typing: true }));
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socketRef.current?.send(JSON.stringify({ type: 'typing', is_typing: false }));
    }, 2000);
  }

  function queueMessage(text, attachment = null) {
    const item = {
      chatId: conversation.id,
      text,
      attachment,
      client_id: `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      queued_at: new Date().toISOString(),
      pending: true,
    };
    loadOutbox().then((pending) => {
      const next = [...pending, item];
      saveOutbox(next);
      setQueue((current) => [...current, item]);
    });
  }

  async function submit() {
    const text = body.trim();
    if (!text) return;
    setBody('');
    if (!connOnline) {
      queueMessage(text);
      return;
    }
    try {
      const message = await sendMessage(conversation.id, text);
      setMessages((current) => sortMessages([...current, message]));
      onConversationsChanged?.();
    } catch (err) {
      if (/internet|reach/i.test(err.message)) queueMessage(text);
      else setError(err.message);
    }
  }

  async function pickImage(fromCamera) {
    if (!ImagePicker) { setError('Image picking is unavailable in this build.'); return; }
    try {
      const permission = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        setError('Permission denied. Enable it in Settings to send photos.');
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const kind = asset.type === 'video' ? 'video' : 'image';
      const file = { uri: asset.uri, name: asset.fileName || `${kind}-${Date.now()}.jpg`, mimeType: asset.mimeType || 'image/jpeg' };
      if (!connOnline) { queueMessage('', file); return; }
      const message = await sendAttachment(conversation.id, file, kind, '');
      setMessages((current) => sortMessages([...current, message]));
    } catch (err) {
      setError(err.message);
    }
  }

  async function pickDocument() {
    if (!DocumentPicker) { setError('Document picking is unavailable in this build.'); return; }
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      const file = { uri: asset.uri, name: asset.name, mimeType: asset.mimeType || 'application/octet-stream' };
      if (!connOnline) { queueMessage('', file); return; }
      const message = await sendAttachment(conversation.id, file, 'file', '');
      setMessages((current) => sortMessages([...current, message]));
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleRecording() {
    if (!ExpoAv) { setError('Voice recording is unavailable in this build.'); return; }
    const { Audio } = ExpoAv;
    if (recording) {
      try {
        recording.setOnRecordingStopped(null);
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        setRecording(null);
        if (uri) {
          const file = { uri, name: `voice-${Date.now()}.m4a`, mimeType: 'audio/mp4' };
          if (!connOnline) { queueMessage('', file); return; }
          const message = await sendAttachment(conversation.id, file, 'audio', '');
          setMessages((current) => sortMessages([...current, message]));
        }
      } catch (err) {
        setRecording(null);
        setError(err.message);
      }
      return;
    }
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        setError('Microphone permission denied. Enable it in Settings to record voice notes.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
    } catch (err) {
      setRecording(null);
      setError(err.message);
    }
  }

  function longPressMessage(message) {
    const options = [];
    if (message.body && !message.is_deleted) options.push('Copy text');
    options.push('Reply info', 'Cancel');
    Alert.alert(
      message.sender?.display_name || 'Message',
      message.is_deleted ? 'This message was deleted' : (message.body || message.attachment_name || 'Attachment'),
      [
        ...(message.body && !message.is_deleted ? [{ text: 'Copy', onPress: () => {
          if (Platform.OS === 'web' && navigator?.clipboard) navigator.clipboard.writeText(message.body);
          else Alert.alert('Copied', 'Message text copied.');
        } }] : []),
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  function tick(state, pending) {
    if (pending) return '◷';
    if (state === 'read') return '✓✓';
    if (state === 'delivered') return '✓✓';
    if (state === 'sent') return '✓';
    return '';
  }

  const renderRow = ({ item, index }) => {
    const mine = item.sender?.id === user.id || item.pending;
    const prev = messages[index - 1];
    const showDay = !prev || new Date(prev.created_at || prev.queued_at).toDateString() !== new Date(item.created_at || item.queued_at).toDateString();
    const showSender = conversation.kind === 'group' && !mine && (!prev || prev.sender?.id !== item.sender?.id);

    return (
      <View>
        {showDay && (
          <View style={styles.dayRow}><Text style={styles.dayText}>{fmtDay(item.created_at || item.queued_at)}</Text></View>
        )}
        {showSender && <Text style={styles.senderName}>{item.sender?.display_name}</Text>}
        <Pressable onLongPress={() => longPressMessage(item)} style={[styles.message, mine ? styles.mine : styles.theirs]}>
          {item.is_deleted ? (
            <Text style={[mine ? styles.mineText : styles.theirsText, styles.deletedText]}><Text>🚫 </Text>Message deleted</Text>
          ) : (
            <>
              {item.attachment_url && item.message_type === 'image' && (
                <Image source={{ uri: item.attachment_url }} style={styles.attachImage} />
              )}
              {item.attachment_url && item.message_type === 'audio' && <VoiceNote uri={item.attachment_url} />}
              {item.attachment_url && !['image', 'audio'].includes(item.message_type) && (
                <View style={styles.attachFile}>
                  <Text style={styles.attachFileName}>{item.attachment_name || 'Attachment'}</Text>
                  <Text style={styles.attachFileSize}>{fmtBytes(item.attachment_size)}</Text>
                </View>
              )}
              {item.body && item.body.trim() ? (
                <Text style={mine ? styles.mineText : styles.theirsText}>{item.body}{item.edited_at ? ' (edited)' : ''}</Text>
              ) : null}
            </>
          )}
          <View style={styles.metaRow}>
            <Text style={mine ? styles.mineTime : styles.theirsTime}>
              {fmtTime(item.created_at || item.queued_at)}
            </Text>
            {mine && <Text style={styles.tick}>{tick(item.state, item.pending)}</Text>}
          </View>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.chatShell}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.chatHeader}>
        {!isWide && (
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
        )}
        <Avatar name={title} color={conversation.kind === 'group' ? '#f6c86b' : colors.accent} uri={peer?.avatar_url} size={38} online={conversation.kind === 'dm' ? peer?.is_online : null} />
        <View style={styles.chatMeta}>
          <Text style={styles.chatTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.status}>
            {peerTyping ? 'typing…' : conversation.kind === 'group'
              ? `${conversation.participants?.length || 0} members`
              : peer?.is_online ? 'online' : peer?.last_seen ? `last seen ${fmtDay(peer.last_seen)}` : 'offline'}
          </Text>
        </View>
      </View>

      {!connOnline && (
        <View style={styles.offlineBar}>
          <Text style={styles.offlineBarText}>You're offline — messages will send when you're back online.</Text>
        </View>
      )}
      <ErrorText message={error} />

      <FlatList
        data={[...queue, ...messages]}
        keyExtractor={(item, i) => String(item.id ?? item.client_id ?? i)}
        renderItem={renderRow}
        inverted
        contentContainerStyle={styles.messageList}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.6}
        ListFooterComponent={hasMore && loadingOlder ? <ActivityIndicator style={{ margin: 10 }} /> : null}
        ListEmptyComponent={<Text style={styles.empty}>Say hello 👋</Text>}
      />

      <View style={styles.composer}>
        <TouchableOpacity style={styles.composerIcon} onPress={() => pickImage(false)}>
          <Text style={styles.composerIconText}>🖼</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.composerIcon} onPress={pickDocument}>
          <Text style={styles.composerIconText}>📎</Text>
        </TouchableOpacity>
        <TextInput
          value={body}
          onChangeText={(text) => { setBody(text); notifyTyping(); }}
          onSubmitEditing={submit}
          style={styles.composerInput}
          placeholder="Message"
          placeholderTextColor={colors.muted}
          multiline
        />
        {body.trim() ? (
          <TouchableOpacity style={styles.sendButton} onPress={submit}>
            <Text style={styles.sendText}>➤</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.sendButton, recording && styles.sendRecording]} onPress={toggleRecording}>
            <Text style={styles.sendText}>{recording ? '■' : '🎤'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/* Group prompt                                                       */
/* ------------------------------------------------------------------ */
function GroupPrompt({ onClose, onCreate }) {
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getChatPeople()
      .then((data) => setPeople(data.people || data.results || []))
      .catch((err) => setError(err.message));
  }, []);

  function toggle(id) {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  async function submit() {
    if (!name.trim()) { setError('Give the group a name.'); return; }
    if (!selected.length) { setError('Select at least one member.'); return; }
    try {
      const group = await createGroup(name.trim(), selected);
      onCreate(group);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <View style={styles.modalBack}>
      <View style={styles.modalCard}>
        <Text style={styles.cardTitle}>New group</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Group name" placeholderTextColor={colors.muted} />
        <ScrollView style={styles.memberList}>
          {people.map((person) => (
            <TouchableOpacity key={person.id} style={styles.memberRow} onPress={() => toggle(person.id)}>
              <Avatar name={person.display_name} color={colors.primaryStrong} size={30} />
              <Text style={styles.name}>{person.display_name}</Text>
              <Text style={styles.check}>{selected.includes(person.id) ? '✓' : ''}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ErrorText message={error} />
        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.ghostButton} onPress={onClose}><Text style={styles.ghostText}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity style={styles.primaryButtonSmall} onPress={submit}><Text style={styles.primaryButtonText}>Create</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Profile & settings                                                 */
/* ------------------------------------------------------------------ */
function ProfileScreen({ user, onSaved, onClose }) {
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [about, setAbout] = useState(user?.about || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true); setError(''); setSaved(false);
    try {
      const data = await updateProfile({ display_name: displayName.trim(), about: about.trim() });
      onSaved(data);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changePhoto() {
    if (!ImagePicker) { setError('Photo picking is unavailable in this build.'); return; }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') { setError('Permission denied. Enable photo access in Settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setBusy(true);
    try {
      const form = new FormData();
      form.append('avatar', { uri: asset.uri, name: 'avatar.jpg', type: asset.mimeType || 'image/jpeg' });
      const data = await fetch(`${require('./api').API_BASE_URL}/api/auth/avatar/`, {
        method: 'POST',
        headers: { Authorization: `Token ${getAuthToken()}`, Accept: 'application/json' },
        body: form,
      }).then((r) => r.json());
      if (data.avatar_url) { onSaved({ ...user, avatar_url: data.avatar_url }); setSaved(true); }
      else setError(data.detail || 'Upload failed');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.modalBack}>
      <View style={styles.modalCard}>
        <Text style={styles.cardTitle}>Your profile</Text>
        <View style={styles.profileHero}>
          <TouchableOpacity onPress={changePhoto}>
            <Avatar name={user?.display_name} color={colors.accent} uri={user?.avatar_url} size={72} />
          </TouchableOpacity>
          <Text style={styles.sub}>{user?.phone_number}</Text>
          {saved ? <Text style={styles.savedNote}>Saved ✓</Text> : null}
        </View>
        <Text style={styles.label}>Display name</Text>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholderTextColor={colors.muted} />
        <Text style={styles.label}>About</Text>
        <TextInput style={styles.input} value={about} onChangeText={setAbout} placeholder="Available on Nexlink" placeholderTextColor={colors.muted} />
        <ErrorText message={error} />
        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.ghostButton} onPress={onClose}><Text style={styles.ghostText}>Close</Text></TouchableOpacity>
          <TouchableOpacity style={styles.primaryButtonSmall} onPress={save} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.darkText} size="small" /> : <Text style={styles.primaryButtonText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function SettingsScreen({ onClose }) {
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getPreferences()
      .then(setPrefs)
      .catch((err) => setError(err.message));
  }, []);

  async function toggle(key) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try { await updatePreferences({ [key]: next[key] }); }
    catch (err) { setError(err.message); setPrefs(prefs); }
  }

  const rows = [
    ['notifications', 'Message notifications'],
    ['sounds', 'Notification sounds'],
    ['read_receipts', 'Read receipts'],
    ['typing_indicator', 'Typing indicator'],
    ['last_seen_visible', 'Show last seen'],
  ];

  return (
    <View style={styles.modalBack}>
      <View style={styles.modalCard}>
        <Text style={styles.cardTitle}>Settings</Text>
        <ErrorText message={error} />
        {!prefs ? <ActivityIndicator style={{ margin: 20 }} /> : rows.map(([key, label]) => (
          <TouchableOpacity key={key} style={styles.memberRow} onPress={() => toggle(key)}>
            <Text style={styles.name}>{label}</Text>
            <View style={[styles.switchTrack, prefs[key] && styles.switchOn]}>
              <View style={[styles.switchThumb, prefs[key] && styles.switchThumbOn]} />
            </View>
          </TouchableOpacity>
        ))}
        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.primaryButtonSmall} onPress={onClose}><Text style={styles.primaryButtonText}>Done</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                */
/* ------------------------------------------------------------------ */
export default function App() {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [groupOpen, setGroupOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState('');
  const [connOnline, setConnOnline] = useState(true);
  const [pushToken, setPushToken] = useState(null);

  /* auto-login */
  useEffect(() => {
    (async () => {
      const token = await loadAuthToken();
      if (!token) { setBooting(false); return; }
      try {
        const me = await getMe();
        setUser({ ...me, id: me.id });
      } catch {
        await setAuthToken(null);
      }
      setBooting(false);
    })();
  }, []);

  /* connection banner state */
  useEffect(() => connectionState.subscribe((state) => setConnOnline(state.online)), []);

  /* load conversations + user-level realtime refresh */
  const refreshConversations = useCallback(() => {
    if (!user) return;
    getConversations()
      .then((data) => setConversations(Array.isArray(data) ? data : data.results || []))
      .catch((err) => setError(err.message));
  }, [user]);

  useEffect(() => { refreshConversations(); }, [user, refreshConversations]);

  useEffect(() => {
    if (!user || !getAuthToken()) return;
    let socket = null;
    let retryTimer = null;
    let closed = false;
    let attempt = 0;

    function connect() {
      socket = new WebSocket(`${WS_BASE_URL}/ws/notifications/?token=${encodeURIComponent(getAuthToken() || '')}`);
      socket.onopen = () => { attempt = 0; connectionState.set({ socket: true }); refreshConversations(); };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (['conversation.new', 'notification.event', 'message.read'].includes(payload.type)) {
            refreshConversations();
          }
        } catch {}
      };
      socket.onclose = () => {
        connectionState.set({ socket: false });
        if (closed) return;
        attempt += 1;
        retryTimer = setTimeout(connect, Math.min(500 * 2 ** attempt, 15000));
      };
    }
    connect();
    return () => { closed = true; clearTimeout(retryTimer); if (socket) socket.close(); };
  }, [user, refreshConversations]);

  /* push notifications: register after login, handle taps */
  useEffect(() => {
    if (!user || !Notifications) return;
    (async () => {
      try {
        const existing = await Notifications.getPermissionsAsync();
        let status = existing.status;
        if (status !== 'granted') {
          const asked = await Notifications.requestPermissionsAsync();
          status = asked.status;
        }
        if (status !== 'granted') return;
        if (Notifications.getDevicePushTokenAsync) {
          // Expo Go / dev: Expo push token; release APK: same via ExpoGo (fcm needs config)
          const tokenResponse = await Notifications.getExpoPushTokenAsync();
          const token = tokenResponse.data;
          setPushToken(token);
          registerPushToken(token).catch(() => {});
        }
        Notifications.setNotificationHandler({
          handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }),
        });
        const sub = Notifications.addNotificationResponseReceivedListener((response) => {
          const conversationId = response?.notification?.request?.content?.data?.conversation_id;
          if (conversationId) {
            const target = conversations.find((c) => String(c.id) === String(conversationId));
            if (target) setActive(target);
          }
        });
        return () => sub.remove();
      } catch {}
    })();
  }, [user, conversations]);

  async function handleSearch(query) {
    if (!query.trim()) return setSearchResults([]);
    try {
      const data = await searchUsers(query);
      setSearchResults(data.results || []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleStart(userId) {
    try {
      const conversation = await startConversation(userId);
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      setSearchResults([]);
      setActive(conversation);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePhoneChat(phone) {
    try {
      const data = await startConversationByPhone(phone);
      const conversation = data.conversation || data;
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      setSearchResults([]);
      setActive(conversation);
    } catch (err) {
      Alert.alert('Nexlink', err.message);
    }
  }

  async function handleLogout() {
    if (pushToken) unregisterPushToken(pushToken).catch(() => {});
    await logout();
    setAuthToken(null);
    setUser(null);
    setConversations([]);
    setActive(null);
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.bootScreen}>
        <Brand />
        <ActivityIndicator color={colors.accent} style={{ marginTop: 18 }} />
      </SafeAreaView>
    );
  }

  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  const chatView = (conv) => (
    <ChatScreen
      user={user}
      conversation={conv}
      onBack={() => setActive(null)}
      isWide={isWide}
      onConversationsChanged={refreshConversations}
      key={conv.id}
    />
  );

  return (
    <>
      {!connOnline && !active && (
        <View style={styles.offlineBar}>
          <Text style={styles.offlineBarText}>You're offline — messages will send when you're back online.</Text>
        </View>
      )}
      <View style={isWide ? styles.appSplit : styles.appStack}>
        <ConversationList
          user={user}
          conversations={conversations}
          onOpen={setActive}
          onLogout={handleLogout}
          onProfile={() => setProfileOpen(true)}
          onSearch={handleSearch}
          searchResults={searchResults}
          onStart={handleStart}
          onGroup={() => setGroupOpen(true)}
          onPhoneChat={handlePhoneChat}
          isWide={isWide}
          connOnline={connOnline}
        />
        {active && isWide && chatView(active)}
      </View>
      {active && !isWide && chatView(active)}
      {groupOpen && (
        <GroupPrompt
          onClose={() => setGroupOpen(false)}
          onCreate={(group) => {
            setConversations((current) => [group, ...current]);
            setGroupOpen(false);
            setActive(group);
          }}
        />
      )}
      {profileOpen && (
        <ProfileScreen
          user={user}
          onSaved={(updated) => setUser((current) => ({ ...current, ...updated }))}
          onClose={() => setProfileOpen(false)}
        />
      )}
      {settingsOpen && <SettingsScreen onClose={() => setSettingsOpen(false)} />}
      {error ? <ErrorText message={error} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  /* app shell */
  appShell: { flex: 1, backgroundColor: colors.bg },
  appStack: { flex: 1, backgroundColor: colors.bg },
  appSplit: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  sidebarPane: { width: 360, borderRightWidth: 1, borderRightColor: colors.border },
  chatShell: { flex: 1, backgroundColor: colors.bg },
  bootScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.welcomeBg },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandIcon: { width: 40, height: 40, borderRadius: 12 },
  brandText: { color: colors.welcomeText, fontWeight: '800', fontSize: 16, letterSpacing: 3 },

  /* auth */
  authPage: { flex: 1, backgroundColor: colors.welcomeBg },
  authPageInner: { flexGrow: 1, justifyContent: 'center', padding: 18 },
  welcomePanel: {
    position: 'relative', overflow: 'hidden', padding: 22, minHeight: 340,
    borderRadius: 28, marginBottom: 20, backgroundColor: colors.welcomeBg,
    borderWidth: 1, borderColor: 'rgba(116,255,214,0.18)',
  },
  welcomeTopline: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  welcomeMark: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(201,255,238,0.38)', alignItems: 'center', justifyContent: 'center',
  },
  welcomeMarkText: { color: colors.welcomeText, fontWeight: '800', fontSize: 18 },
  welcomeBrand: { color: colors.welcomeText, fontWeight: '800', fontSize: 12, letterSpacing: 2 },
  welcomeContent: { zIndex: 2, marginTop: 34 },
  welcomeEyebrow: { color: colors.welcomeAccent, fontSize: 11, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 },
  heroTitle: { color: colors.welcomeText, fontSize: 36, lineHeight: 42, fontWeight: '400', fontStyle: 'italic', maxWidth: 260 },
  welcomeLead: { marginTop: 16, color: 'rgba(242,255,251,0.74)', fontSize: 15, lineHeight: 23, maxWidth: 420 },
  welcomeSignal: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  signalDot: { width: 9, height: 9, borderRadius: 999, backgroundColor: colors.welcomeAccent },
  signalText: { color: 'rgba(242,255,251,0.7)', fontSize: 11, fontWeight: '700' },
  signalLine: { width: 35, height: 1, backgroundColor: 'rgba(242,255,251,0.25)' },
  visualGlow: {
    position: 'absolute', right: -80, bottom: -70, width: 280, height: 280, borderRadius: 140,
    borderWidth: 1, borderColor: 'rgba(116,255,214,0.20)', backgroundColor: 'rgba(116,255,214,0.08)',
  },
  visualOut: {
    position: 'absolute', right: 38, bottom: 28, width: 150, height: 150, borderRadius: 48,
    backgroundColor: 'rgba(116,255,214,0.1)', borderWidth: 1, borderColor: 'rgba(116,255,214,0.20)',
  },
  welcomeFooter: { position: 'absolute', bottom: 16, left: 22, fontSize: 10, letterSpacing: 2, color: 'rgba(242,255,251,0.42)' },
  authCard: { backgroundColor: colors.surface, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: colors.border },
  authBrand: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  authBrandLogo: { width: 26, height: 26, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  authBrandLogoText: { color: '#062024', fontWeight: '900', fontSize: 14 },
  authBrandText: { color: colors.text, fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  cardTitle: { color: colors.text, fontSize: 25, fontWeight: '800', marginBottom: 6 },
  cardSubtitle: { color: colors.muted, fontSize: 14, marginBottom: 16 },
  field: { marginBottom: 13 },
  label: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 7 },
  input: {
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    paddingHorizontal: 13, paddingVertical: 12, color: colors.text, fontSize: 15,
  },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
  primaryButtonSmall: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  primaryButtonText: { color: '#062024', fontWeight: '800', fontSize: 15 },
  switchText: { color: colors.primaryStrong, textAlign: 'center', marginTop: 14, fontWeight: '600' },

  /* sidebar */
  sidebarHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  profileName: { color: colors.text, fontWeight: '800', fontSize: 15 },
  connText: { fontSize: 11, fontWeight: '700' },
  connOn: { color: colors.success },
  connOff: { color: colors.danger },
  iconButton: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  iconText: { color: colors.primaryStrong, fontSize: 17, fontWeight: '700' },
  searchArea: { paddingHorizontal: 16, paddingBottom: 6 },
  searchInput: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    paddingHorizontal: 13, paddingVertical: 10, color: colors.text, fontSize: 14,
  },
  searchResults: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 },
  searchPerson: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  phoneChatRow: {
    marginHorizontal: 16, marginTop: 4, marginBottom: 4, paddingVertical: 10, paddingHorizontal: 13,
    backgroundColor: colors.primarySoft, borderRadius: 12, borderWidth: 1, borderColor: colors.primary,
  },
  phoneChatText: { color: colors.primaryStrong, fontWeight: '700', fontSize: 13.5 },
  sectionTitle: {
    color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2,
    textTransform: 'uppercase', paddingHorizontal: 16, marginTop: 10, marginBottom: 4,
  },
  list: { paddingBottom: 12 },
  conversation: { flexDirection: 'row', gap: 11, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
  conversationBody: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { color: colors.text, fontWeight: '700', fontSize: 14.5, flexShrink: 1 },
  sub: { color: colors.muted, fontSize: 12, marginTop: 1 },
  time: { color: colors.muted, fontSize: 11.5 },
  preview: { color: colors.muted, fontSize: 13, flex: 1, marginRight: 6 },
  mutedIcon: { fontSize: 11, marginHorizontal: 2 },
  unread: {
    backgroundColor: colors.primary, minWidth: 21, height: 21, borderRadius: 11,
    paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
  },
  unreadText: { color: '#062024', fontSize: 11.5, fontWeight: '800' },
  empty: { color: colors.muted, textAlign: 'center', padding: 22, fontSize: 13.5 },
  logout: { alignItems: 'center', padding: 14, borderTopWidth: 1, borderTopColor: colors.border },
  footerLink: { color: colors.danger, fontWeight: '700' },

  /* chat */
  chatHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backButton: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.text, fontSize: 22, fontWeight: '700' },
  chatMeta: { flex: 1 },
  chatTitle: { color: colors.text, fontWeight: '800', fontSize: 15 },
  status: { color: colors.muted, fontSize: 12 },
  senderName: { color: colors.muted, fontSize: 11.5, fontWeight: '700', marginLeft: 14, marginBottom: 2 },
  messageList: { paddingHorizontal: 12, paddingVertical: 10 },
  dayRow: { alignItems: 'center', marginVertical: 8 },
  dayText: {
    color: colors.muted, fontSize: 11, fontWeight: '700', backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: 'hidden',
  },
  message: {
    maxWidth: '82%', borderRadius: 16, paddingHorizontal: 11, paddingVertical: 7, marginVertical: 2.5,
  },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 5 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 5 },
  mineText: { color: '#062024', fontSize: 14.5, lineHeight: 20 },
  theirsText: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  deletedText: { fontStyle: 'italic', opacity: 0.7 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 },
  mineTime: { color: 'rgba(6,32,36,0.62)', fontSize: 10 },
  theirsTime: { color: colors.muted, fontSize: 10 },
  tick: { color: '#062024', fontSize: 10, fontWeight: '800' },
  attachImage: { width: 220, height: 150, borderRadius: 10, marginBottom: 4, backgroundColor: colors.surfaceAlt },
  attachFile: { backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 10, padding: 9, marginBottom: 4, minWidth: 150 },
  attachFileName: { color: colors.text, fontWeight: '700', fontSize: 13 },
  attachFileSize: { color: colors.muted, fontSize: 11.5 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6 },
  voiceIcon: { color: colors.primaryStrong, fontSize: 16, fontWeight: '800' },
  voiceLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  offlineBar: { backgroundColor: '#5f1f1f', paddingVertical: 7, paddingHorizontal: 12 },
  offlineBarText: { color: '#fecaca', textAlign: 'center', fontSize: 12, fontWeight: '600' },

  /* composer */
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    padding: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
  composerIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  composerIconText: { fontSize: 18 },
  composerInput: {
    flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    borderRadius: 20, paddingHorizontal: 13, paddingTop: 9, paddingBottom: 9,
    color: colors.text, fontSize: 15, maxHeight: 110,
  },
  sendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendRecording: { backgroundColor: colors.danger },
  sendText: { color: '#062024', fontSize: 16, fontWeight: '800' },

  /* presence + switches */
  presenceDot: {
    position: 'absolute', borderRadius: 999, borderWidth: 2, borderColor: colors.bg,
    backgroundColor: colors.muted,
  },
  presenceOn: { backgroundColor: colors.success },
  switchTrack: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: colors.border,
    padding: 2, justifyContent: 'flex-start',
  },
  switchOn: { backgroundColor: colors.primary, justifyContent: 'flex-end' },
  switchThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#ffffff' },
  switchThumbOn: { backgroundColor: '#062024' },

  /* modals */
  modalBack: {
    position: 'absolute', inset: 0, backgroundColor: 'rgba(7,29,34,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: 18, zIndex: 50,
  },
  modalCard: {
    width: '100%', maxWidth: 460, maxHeight: '82%', backgroundColor: colors.surface,
    borderRadius: 22, padding: 18, borderWidth: 1, borderColor: colors.border,
  },
  modalActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 12 },
  ghostButton: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center' },
  ghostText: { color: colors.muted, fontWeight: '700' },
  memberList: { maxHeight: 260, marginTop: 6 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  check: { color: colors.primary, fontWeight: '900', fontSize: 16, marginLeft: 'auto' },
  profileHero: { alignItems: 'center', marginVertical: 12 },
  savedNote: { color: colors.success, fontWeight: '700', fontSize: 12, marginTop: 4 },

  /* errors + avatar */
  errorBox: { backgroundColor: colors.dangerSoft, borderRadius: 10, padding: 9, marginVertical: 6 },
  errorText: { color: colors.danger, fontSize: 12.5, textAlign: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#062024', fontWeight: '800' },
});
