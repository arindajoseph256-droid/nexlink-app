import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
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
  getChatPeople,
  getConversations,
  getMessages,
  getAuthToken,
  login,
  logout,
  markRead,
  register,
  searchUsers,
  sendMessage,
  setAuthToken,
  startConversation,
  WS_BASE_URL,
} from './api';

const nexlinkIcon = require('./assets/icon.png');

const colors = {
  bg: '#f4f6fb',
  panel: '#ffffff',
  surface: '#ffffff',
  surfaceAlt: '#eef1f8',
  surfaceSoft: '#f8f9fc',
  border: '#dfe4ef',
  text: '#1c2333',
  muted: '#667085',
  primary: '#4f6ef7',
  primaryStrong: '#3d5bee',
  primarySoft: '#eef1ff',
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
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'N';
}

function Brand() {
  return (
    <View style={styles.brandRow}>
      <Image source={nexlinkIcon} style={styles.brandLogo} />
      <Text style={styles.brandText}>NEXLINK</Text>
    </View>
  );
}

function ErrorText({ message }) {
  return message ? <Text style={styles.error}>{message}</Text> : null;
}

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
    if (mode === 'register' && (!fullName.trim() || !identifier.trim() || !email.trim() || !password)) {
      setError('Full name, phone number, email, and password are required.');
      return;
    }
    if (mode === 'login' && (!identifier.trim() || !password)) {
      setError('Enter your phone number or email and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result =
        mode === 'login'
          ? await login(identifier, password)
          : await register({
              full_name: fullName,
              phone_number: identifier,
              email,
              about,
              password1: password,
              password2: password,
            });
      setAuthToken(result.token);
      onAuthenticated(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.authPage}>
        <View style={styles.welcomePanel}>
          <View style={styles.welcomeTopline}>
            <Image source={nexlinkIcon} style={styles.welcomeMark} />
            <Text style={styles.welcomeBrand}>NEXLINK</Text>
          </View>

          <View style={styles.welcomeContent}>
            <Text style={styles.welcomeEyebrow}>Your people, in one place</Text>
            <Text style={styles.heroTitle}>Make room for{`\n`}better conversations.</Text>
            <Text style={styles.welcomeLead}>
              A calmer way to stay close, share the moment, and keep every important thread within reach.
            </Text>
            <View style={styles.welcomeSignal}>
              <View style={styles.signalDot} />
              <Text style={styles.signalText}>Private by design</Text>
              <View style={styles.signalLine} />
              <Text style={styles.signalText}>Realtime when it matters</Text>
            </View>
          </View>

          <View style={styles.visualGlow} />
          <View style={styles.visualOut} />
          <Text style={styles.welcomeFooter}>NEXLINK / 2026</Text>
        </View>

        <View style={styles.authCard}>
          <View style={styles.authBrand}>
            <Image source={nexlinkIcon} style={styles.authBrandLogo} />
            <Text style={styles.authBrandText}>NEXLINK</Text>
          </View>

          <Text style={styles.cardTitle}>{mode === 'login' ? 'Welcome back' : 'Create your account'}</Text>
          <Text style={styles.cardSubtitle}>
            {mode === 'login' ? 'Sign in to continue your conversations.' : 'Use the same account as the web app.'}
          </Text>

          <ErrorText message={error} />

          {mode === 'register' && (
            <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Alice Nakato" />
          )}

          <Field
            label={mode === 'login' ? 'Phone number or email' : 'Phone number'}
            value={identifier}
            onChangeText={setIdentifier}
            placeholder={mode === 'login' ? '+256 700 000 000 or you@example.com' : '+256 700 000 000'}
            keyboardType={mode === 'login' ? 'default' : 'phone-pad'}
          />

          {mode === 'register' && (
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
          )}

          {mode === 'register' && (
            <Field label="About (optional)" value={about} onChangeText={setAbout} placeholder="A short status" />
          )}

          <Field label="Password" value={password} onChangeText={setPassword} placeholder="Enter your password" secureTextEntry />

          <TouchableOpacity style={styles.primaryButton} onPress={submit} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#071d22" />
            ) : (
              <Text style={styles.primaryButtonText}>{mode === 'login' ? 'Sign in' : 'Create account'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
          >
            <Text style={styles.secondaryButtonText}>
              {mode === 'login' ? 'Create account' : 'I already have an account'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        style={styles.input}
      />
    </View>
  );
}

function Avatar({ name, color = colors.primaryStrong }) {
  return (
    <View style={[styles.avatar, { backgroundColor: color }]}>
      <Text style={styles.avatarText}>{initials(name)}</Text>
    </View>
  );
}

function ConversationList({ user, conversations, onOpen, onLogout, onSearch, searchResults, onStart, onGroup, isWide }) {
  return (
    <SafeAreaView style={[styles.appShell, isWide && styles.sidebarPane]}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.sidebarHeader}>
        <View style={styles.profileRow}>
          <Avatar name={user?.display_name} color="#74ffd6" />
          <Text style={styles.profileName}>{user?.display_name || 'NEXLINK'}</Text>
        </View>

        <TouchableOpacity style={styles.iconButton} onPress={onGroup}>
          <Text style={styles.iconText}>◎</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchArea}>
        <TextInput
          style={styles.searchInput}
          placeholder="Enter phone, email, or name..."
          placeholderTextColor={colors.muted}
          onChangeText={onSearch}
        />
      </View>

      {searchResults.length > 0 && (
        <View style={styles.searchResults}>
          {searchResults.map((person) => (
            <TouchableOpacity key={person.id} style={styles.searchPerson} onPress={() => onStart(person.id)}>
              <Avatar name={person.display_name} color="#3ad8bf" />
              <Text style={styles.name}>{person.display_name}</Text>
            </TouchableOpacity>
          ))}
        </View>
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
          const preview = item.last_message?.body || 'No messages yet';

          return (
            <TouchableOpacity style={styles.conversation} onPress={() => onOpen(item)}>
              <Avatar name={name} color={item.kind === 'group' ? '#f6c86b' : '#7dd3fc'} />
              <View style={styles.conversationBody}>
                <View style={styles.row}>
                  <Text style={styles.name}>{name}</Text>
                  <Text style={styles.time}>
                    {item.last_message ? new Date(item.last_message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.preview} numberOfLines={1}>{preview}</Text>
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

function ChatScreen({ user, conversation, onBack, isWide }) {
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const peer = conversation.kind === 'group' ? null : conversation.participants?.find((person) => person.id !== user.id);
  const title = conversation.kind === 'group' ? conversation.name : peer?.display_name || 'Conversation';

  useEffect(() => {
    const socket = new WebSocket(`${WS_BASE_URL}/ws/chat/${conversation.id}/?token=${encodeURIComponent(getAuthToken() || '')}`);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'presence.ping' }));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'message.new' && payload.message) {
          setMessages((current) =>
            current.some((message) => message.id === payload.message.id) ? current : [...current, payload.message],
          );
        }
      } catch {}
    };
    return () => socket.close();
  }, [conversation.id]);

  useEffect(() => {
    let mounted = true;
    getMessages(conversation.id)
      .then((data) => {
        if (mounted) setMessages(data?.results || []);
        markRead(conversation.id).catch(() => {});
      })
      .catch((err) => setError(err.message));
    return () => {
      mounted = false;
    };
  }, [conversation.id]);

  async function submit() {
    const text = body.trim();
    if (!text) return;
    try {
      const message = await sendMessage(conversation.id, text);
      setMessages((current) => [...current, message]);
      setBody('');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <SafeAreaView style={[styles.chatShell, isWide && styles.chatPane]}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.chatHeader}>
        {!isWide && (
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
        )}
        <Avatar name={title} color={conversation.kind === 'group' ? '#f6c86b' : '#74ffd6'} />
        <View style={styles.chatMeta}>
          <Text style={styles.chatTitle}>{title}</Text>
          <Text style={styles.status}>{conversation.kind === 'group' ? `${conversation.participants?.length || 0} members` : peer?.is_online ? 'online' : 'offline'}</Text>
        </View>
      </View>

      <ErrorText message={error} />

      <ScrollView contentContainerStyle={styles.messageList}>
        {messages.map((message) => {
          const mine = message.sender?.id === user.id;
          return (
            <View key={message.id} style={[styles.message, mine ? styles.mine : styles.theirs]}>
              <Text style={mine ? styles.mineText : styles.theirsText}>
                {message.is_deleted ? 'Message deleted' : message.body}
              </Text>
              <Text style={mine ? styles.mineTime : styles.theirsTime}>
                {new Date(message.created_at || message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={body}
          onChangeText={setBody}
          onSubmitEditing={submit}
          style={styles.composerInput}
          placeholder="Write a message..."
          placeholderTextColor={colors.muted}
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={submit}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function GroupPrompt({ onClose, onCreate }) {
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getChatPeople()
      .then((data) => setPeople(data.results || []))
      .catch((err) => setError(err.message));
  }, []);

  function toggle(id) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function submit() {
    try {
      const group = await createGroup(name, selected);
      onCreate(group);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <View style={styles.modalBackdrop}>
      <View style={styles.modal}>
        <Text style={styles.cardTitle}>New group</Text>
        <ErrorText message={error} />
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Group name" />
        <Text style={styles.sectionTitle}>People you have chatted with</Text>
        <ScrollView style={styles.people}>
          {people.map((person) => (
            <TouchableOpacity
              key={person.id}
              style={[styles.person, selected.includes(person.id) && styles.selectedPerson]}
              onPress={() => toggle(person.id)}
            >
              <Avatar name={person.display_name} color="#3ad8bf" />
              <View style={styles.personTextWrap}>
                <Text style={styles.name}>{person.display_name}</Text>
                <Text style={styles.preview}>{person.masked_phone}</Text>
              </View>
              <Text style={styles.check}>{selected.includes(person.id) ? '✓' : ''}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButtonSmall} onPress={submit} disabled={!name.trim() || !selected.length}>
            <Text style={styles.primaryButtonText}>Create</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function App() {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const [user, setUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [groupOpen, setGroupOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      getConversations().then(setConversations).catch((err) => setError(err.message));
    }
  }, [user]);

  if (!user) return <AuthScreen onAuthenticated={setUser} />;
  if (active && !isWide) return <ChatScreen user={user} conversation={active} onBack={() => setActive(null)} isWide={isWide} />;

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

  async function handleLogout() {
    try {
      await logout();
    } catch {}
    setAuthToken(null);
    setUser(null);
    setConversations([]);
  }

  return (
    <>
      {error ? <ErrorText message={error} /> : null}
      <View style={isWide ? styles.appSplit : styles.appStack}>
        <ConversationList
          user={user}
          conversations={conversations}
          onOpen={setActive}
          onLogout={handleLogout}
          onSearch={handleSearch}
          searchResults={searchResults}
          onStart={handleStart}
          onGroup={() => setGroupOpen(true)}
          isWide={isWide}
        />
        {active && isWide && (
          <ChatScreen user={user} conversation={active} onBack={() => setActive(null)} isWide={isWide} />
        )}
      </View>
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
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  appStack: { flex: 1, backgroundColor: colors.bg },
  appSplit: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  appShell: { flex: 1, backgroundColor: colors.bg },
  sidebarPane: { width: 340, borderRightWidth: 1, borderRightColor: colors.border },
  chatShell: { flex: 1, backgroundColor: colors.bg },
  chatPane: { flex: 1, backgroundColor: colors.bg },
  authPage: {
    flexGrow: 1,
    justifyContent: 'center',
    backgroundColor: colors.welcomeBg,
    padding: 18,
  },
  welcomePanel: {
    position: 'relative',
    overflow: 'hidden',
    padding: 22,
    minHeight: 360,
    borderRadius: 28,
    marginBottom: 20,
    backgroundColor: colors.welcomeBg,
    borderWidth: 1,
    borderColor: 'rgba(116,255,214,0.18)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
  },
  welcomeTopline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
  },
  welcomeMark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(201,255,238,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeMarkText: {
    color: colors.welcomeText,
    fontWeight: '800',
    fontSize: 18,
  },
  welcomeBrand: {
    color: colors.welcomeText,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 2,
  },
  welcomeContent: {
    zIndex: 2,
    marginTop: 40,
  },
  welcomeEyebrow: {
    color: colors.welcomeAccent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  heroTitle: {
    color: colors.welcomeText,
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '400',
    fontStyle: 'italic',
    maxWidth: 180,
  },
  welcomeLead: {
    marginTop: 18,
    color: 'rgba(242,255,251,0.74)',
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 420,
  },
  welcomeSignal: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  signalDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.welcomeAccent,
    shadowColor: colors.welcomeAccent,
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  signalText: {
    color: 'rgba(242,255,251,0.7)',
    fontSize: 11,
    fontWeight: '700',
  },
  signalLine: {
    width: 35,
    height: 1,
    backgroundColor: 'rgba(242,255,251,0.25)',
  },
  visualGlow: {
    position: 'absolute',
    right: -80,
    bottom: -70,
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 1,
    borderColor: 'rgba(116,255,214,0.20)',
    backgroundColor: 'rgba(116,255,214,0.08)',
  },
  visualOut: {
    position: 'absolute',
    right: 38,
    bottom: 28,
    width: 170,
    height: 170,
    borderRadius: 48,
    backgroundColor: 'rgba(116,255,214,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(116,255,214,0.20)',
  },
  welcomeFooter: {
    position: 'absolute',
    bottom: 18,
    left: 22,
    fontSize: 10,
    letterSpacing: 2,
    color: 'rgba(242,255,251,0.42)',
  },
  authCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#101828',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  authBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  authBrandLogo: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authBrandLogoText: {
    color: colors.darkText,
    fontWeight: '900',
    fontSize: 14,
  },
  authBrandText: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 6,
  },
  cardSubtitle: {
    color: colors.muted,
    fontSize: 14,
    marginBottom: 16,
  },
  field: {
    marginBottom: 14,
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 7,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonSmall: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    color: colors.primaryStrong,
    fontSize: 15,
    fontWeight: '700',
  },
  error: {
    color: colors.danger,
    backgroundColor: 'rgba(255,127,153,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,127,153,0.2)',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
    fontSize: 13,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  brandLogo: {
    width: 36,
    height: 36,
    borderRadius: 12,
    resizeMode: 'cover',
  },
  brandText: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 20,
    letterSpacing: 1,
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  profileRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileName: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 15,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  searchArea: {
    padding: 10,
    backgroundColor: colors.surface,
  },
  searchInput: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
  },
  searchResults: {
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  searchPerson: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  list: {
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  conversation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  conversationBody: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  time: {
    color: colors.muted,
    fontSize: 11,
  },
  preview: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  unread: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignItems: 'center',
  },
  unreadText: {
    color: colors.darkText,
    fontSize: 10,
    fontWeight: '800',
  },
  empty: {
    textAlign: 'center',
    color: colors.muted,
    padding: 32,
    fontSize: 14,
    lineHeight: 20,
  },
  logout: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  footerLink: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.darkText,
    fontWeight: '900',
    fontSize: 12,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chatMeta: {
    flex: 1,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  backText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  chatTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  status: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '700',
  },
  messageList: {
    padding: 14,
    gap: 9,
  },
  message: {
    maxWidth: '78%',
    borderRadius: 14,
    padding: 11,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mineText: {
    color: colors.darkText,
    fontSize: 15,
  },
  theirsText: {
    color: colors.text,
    fontSize: 15,
  },
  mineTime: {
    color: 'rgba(7,29,34,0.72)',
    fontSize: 10,
    marginTop: 4,
  },
  theirsTime: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 4,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 9,
    padding: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  composerInput: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 10,
    color: colors.text,
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sendText: {
    color: colors.darkText,
    fontWeight: '800',
  },
  modalBackdrop: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(2,10,12,0.75)',
    justifyContent: 'center',
    padding: 16,
  },
  modal: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 18,
    maxHeight: '82%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  people: {
    maxHeight: 260,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 9,
    borderRadius: 10,
  },
  personTextWrap: {
    flex: 1,
  },
  selectedPerson: {
    backgroundColor: colors.primarySoft,
  },
  check: {
    marginLeft: 'auto',
    color: colors.primary,
    fontSize: 20,
    fontWeight: '800',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
});
