import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import {
  connectionState,
  getConversations,
  getNotifications,
  markNotificationsRead,
  searchMessages,
  searchUsers,
  setConversationState,
  startConversation,
  startConversationByPhone,
  clearChat,
} from '../api';
import { ConversationItem } from '../components/ConversationItem';
import { NotificationsModal } from '../components/NotificationsModal';
import { SearchBar } from '../components/SearchBar';
import { Avatar, LoadingState } from '../components/ui';
import { onRealtimeEvent } from '../services/realtimeBus';
import { onForegroundSync } from '../services/syncService';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';
import { fmtDay } from '../utils/formatting';

/* Same filter set as the web dashboard (static/js/nexus.js). */
const FILTERS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['pinned', 'Pinned'],
  ['groups', 'Groups'],
  ['archived', 'Archived'],
];

export function ConversationsScreen({ user, onLogout }) {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [conversations, setConversations] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [messageResults, setMessageResults] = useState([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [notifCount, setNotifCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [online, setOnline] = useState(connectionState.online);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await getConversations();
      setConversations(Array.isArray(data) ? data : data.results || []);
      setError('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const data = await getNotifications();
      setNotifCount(data.unread || 0);
    } catch {}
  }, []);

  /* Notifications tap → resolve the conversation from the list (single-conversation
     GET is not part of the API; the list is cheap and already cached by the client). */
  const openConversationById = useCallback(
    async (conversationId) => {
      try {
        const data = await getConversations();
        const list = Array.isArray(data) ? data : data.results || [];
        setConversations(list);
        const conversation = list.find((item) => String(item.id) === String(conversationId));
        if (conversation) {
          navigation.navigate('Chat', { conversation });
          return;
        }
        Alert.alert('Nexlink', 'That conversation is no longer available.');
      } catch (err) {
        Alert.alert('Nexlink', friendlyError(err));
      }
    },
    [navigation],
  );

  useEffect(() => {
    refresh();
    refreshNotifications();
    const off = connectionState.subscribe((state) => setOnline(state.online));
    const offSync = onForegroundSync(() => {
      refresh();
      refreshNotifications();
    });
    return () => {
      off();
      offSync();
    };
  }, [refresh, refreshNotifications]);

  /* realtime fan-out: list + unread badge refresh while this screen is focused */
  useFocusEffect(
    useCallback(() => {
      refresh();
      refreshNotifications();
      const offRealtime = onRealtimeEvent((event) => {
        const type = event?.type;
        if (type === 'conversation.new' || type === 'message.new' || type === 'notification.event') refresh();
        if (type === 'notification.event' || type === 'message.new') refreshNotifications();
      });
      return offRealtime;
    }, [refresh, refreshNotifications]),
  );

  const phoneCandidate = useMemo(() => {
    const digits = query.replace(/[^\d+]/g, '');
    return digits.length >= 7 ? digits : null;
  }, [query]);

  /* Web-equivalent list filtering: archived only shows under Archived. */
  const filteredConversations = useMemo(() => {
    const items = conversations.filter((conversation) => {
      if (filter === 'archived') return conversation.archived;
      if (conversation.archived) return false;
      if (filter === 'unread' && !(conversation.unread_count > 0)) return false;
      if (filter === 'pinned' && !conversation.pinned) return false;
      if (filter === 'groups' && conversation.kind !== 'group') return false;
      return true;
    });
    return [...items].sort((a, b) => Boolean(b.pinned) - Boolean(a.pinned));
  }, [conversations, filter]);

  const searchMode = query.trim().length > 0;
  const searchItems = useMemo(() => {
    const people = searchResults.map((person) => ({ key: `u${person.id}`, type: 'person', person }));
    const hits = messageResults.map((message) => ({ key: `m${message.id}`, type: 'message', message }));
    return [...people, ...hits];
  }, [searchResults, messageResults]);

  async function handleSearch(text) {
    setQuery(text);
    if (!text.trim()) {
      setSearchResults([]);
      setMessageResults([]);
      return;
    }
    try {
      const data = await searchUsers(text);
      setSearchResults(data.results || []);
    } catch {}
    if (text.trim().length >= 2) {
      try {
        const data = await searchMessages(text);
        setMessageResults(data.results || []);
      } catch {
        setMessageResults([]);
      }
    }
  }

  async function openWithUser(userId) {
    try {
      const conversation = await startConversation(userId);
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      setSearchResults([]);
      setMessageResults([]);
      setQuery('');
      navigation.navigate('Chat', { conversation });
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  /* Tap a message hit → open the conversation it came from. */
  function openMessageHit(message) {
    const conversation = conversations.find((item) => String(item.id) === String(message.conversation_id));
    if (conversation) {
      setSearchResults([]);
      setMessageResults([]);
      setQuery('');
      navigation.navigate('Chat', { conversation });
      return;
    }
    openConversationById(message.conversation_id);
  }

  async function openPhoneChat(phone) {
    try {
      const data = await startConversationByPhone(phone);
      const conversation = data.conversation || data;
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      setSearchResults([]);
      setQuery('');
      navigation.navigate('Chat', { conversation });
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function handleChatState(conversation, action, value) {
    try {
      if (action === 'clear') await clearChat(conversation.id);
      else await setConversationState(conversation.id, { [action]: value });
      refresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  function openNotifications() {
    setNotifOpen(true);
  }

  const styles = makeStyles(colors, accent);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.profileRow} onPress={() => navigation.navigate('Profile')}>
          <Avatar name={user?.display_name} uri={user?.avatar_url} size={38} />
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName} numberOfLines={1}>
              {user?.display_name || 'NEXLINK'}
            </Text>
            <Text style={[styles.connText, { color: online ? colors.success : colors.danger }]}>
              {online ? 'connected' : 'offline'}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={openNotifications}>
          <Text style={{ fontSize: 20 }}>🔔</Text>
          {notifCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{notifCount > 9 ? '9+' : notifCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Contacts')}>
          <Text style={{ fontSize: 19 }}>👥</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('GroupCreate')}>
          <Text style={{ fontSize: 20 }}>◎</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Settings')}>
          <Text style={{ fontSize: 18 }}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <SearchBar value={query} onChangeText={handleSearch} />

      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : null}

      {searchMode ? (
        <FlatList
          data={searchItems}
          keyExtractor={(item) => item.key}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            searchItems.length === 0 && !phoneCandidate ? (
              <Text style={styles.empty}>No people or messages match “{query.trim()}”.</Text>
            ) : null
          }
          ListFooterComponent={
            phoneCandidate ? (
              <TouchableOpacity style={styles.phoneRow} onPress={() => openPhoneChat(phoneCandidate)}>
                <Text style={{ color: accent, fontWeight: '700' }}>Chat with {phoneCandidate}</Text>
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item }) =>
            item.type === 'person' ? (
              <TouchableOpacity style={styles.personRow} onPress={() => openWithUser(item.person.id)}>
                <Avatar name={item.person.display_name} uri={item.person.avatar_url} size={36} online={item.person.is_online} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{item.person.display_name}</Text>
                  {item.person.masked_phone ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{item.person.masked_phone}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.personRow} onPress={() => openMessageHit(item.message)}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11.5, fontWeight: '700' }}>
                    💬 MESSAGE · {fmtDay(item.message.created_at)}
                  </Text>
                  <Text style={{ color: colors.text, fontSize: 14.5, marginTop: 2 }} numberOfLines={2}>
                    {item.message.body}
                  </Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
              </TouchableOpacity>
            )
          }
        />
      ) : (
        <>
          <View style={styles.chipRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipTrack}>
              {FILTERS.map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: filter === key ? accent : colors.surface,
                      borderColor: filter === key ? accent : colors.border,
                    },
                  ]}
                  onPress={() => setFilter(key)}
                >
                  <Text style={[styles.chipText, { color: filter === key ? '#071d22' : colors.text }]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <Text style={styles.sectionTitle}>
            {FILTERS.find(([key]) => key === filter)?.[1]?.toUpperCase() || 'CONVERSATIONS'}
          </Text>
          {loading ? (
            <LoadingState label="Loading conversations…" />
          ) : (
            <FlatList
              data={filteredConversations}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {filter === 'all'
                    ? 'No conversations yet. Search for someone to start chatting.'
                    : 'Nothing here — try another filter.'}
                </Text>
              }
              renderItem={({ item }) => (
                <ConversationItem
                  conversation={item}
                  currentUser={user}
                  onOpen={(conversation) => navigation.navigate('Chat', { conversation })}
                  onChatState={handleChatState}
                />
              )}
            />
          )}
        </>
      )}

      <NotificationsModal
        visible={notifOpen}
        onClose={() => {
          setNotifOpen(false);
          refreshNotifications();
        }}
        onOpenConversation={openConversationById}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors, accent) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 4,
      gap: 4,
    },
    profileRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
    profileName: { color: colors.text, fontWeight: '700', fontSize: 16 },
    connText: { fontSize: 11.5, fontWeight: '600' },
    iconButton: { paddingHorizontal: 8, paddingVertical: 6 },
    badge: {
      position: 'absolute',
      top: 0,
      right: 2,
      backgroundColor: colors.danger,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    badgeText: { color: '#fff', fontSize: 9.5, fontWeight: '800' },
    sectionTitle: {
      color: colors.muted,
      fontSize: 11.5,
      fontWeight: '800',
      letterSpacing: 1,
      marginTop: 14,
      marginBottom: 4,
      marginHorizontal: 16,
    },
    personRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
    phoneRow: {
      marginHorizontal: 14,
      marginTop: 4,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
    },
    errorText: { color: colors.danger, fontSize: 12.5, paddingHorizontal: 16, paddingVertical: 4 },
    chipRow: { paddingHorizontal: 12, marginBottom: 2 },
    chipTrack: { gap: 8, paddingRight: 8 },
    chip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    chipText: { fontSize: 13, fontWeight: '700' },
    list: { paddingBottom: 24 },
    empty: { color: colors.muted, textAlign: 'center', marginTop: 40, marginHorizontal: 30, lineHeight: 20 },
  });
}
