import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import {
  connectionState,
  getConversations,
  getNotifications,
  markNotificationsRead,
  searchUsers,
  setConversationState,
  startConversation,
  startConversationByPhone,
  clearChat,
} from '../api';
import { ConversationItem } from '../components/ConversationItem';
import { SearchBar } from '../components/SearchBar';
import { Avatar, LoadingState } from '../components/ui';
import { nexlinkIcon } from '../branding';
import { notificationsAvailable } from '../services/notifications';
import { onForegroundSync } from '../services/syncService';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

export function ConversationsScreen({ user, onLogout }) {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [conversations, setConversations] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [query, setQuery] = useState('');
  const [notifCount, setNotifCount] = useState(0);
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
    if (!notificationsAvailable()) return;
    try {
      const data = await getNotifications();
      setNotifCount(data.unread || 0);
    } catch {}
  }, []);

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

  const phoneCandidate = useMemo(() => {
    const digits = query.replace(/[^\d+]/g, '');
    return digits.length >= 7 ? digits : null;
  }, [query]);

  async function handleSearch(text) {
    setQuery(text);
    if (!text.trim()) return setSearchResults([]);
    try {
      const data = await searchUsers(text);
      setSearchResults(data.results || []);
    } catch {}
  }

  async function openWithUser(userId) {
    try {
      const conversation = await startConversation(userId);
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      setSearchResults([]);
      setQuery('');
      navigation.navigate('Chat', { conversation });
    } catch (err) {
      setError(friendlyError(err));
    }
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
    navigation.navigate('Settings');
    markNotificationsRead().catch(() => {});
    setNotifCount(0);
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

      {searchResults.length > 0 ? (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => String(item.id)}
          ListHeaderComponent={<Text style={styles.sectionTitle}>PEOPLE</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.personRow} onPress={() => openWithUser(item.id)}>
              <Avatar name={item.display_name} uri={item.avatar_url} size={36} online={item.is_online} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{item.display_name}</Text>
                {item.masked_phone ? (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{item.masked_phone}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
        />
      ) : (
        <>
          {phoneCandidate && (
            <TouchableOpacity style={styles.phoneRow} onPress={() => openPhoneChat(phoneCandidate)}>
              <Text style={{ color: accent, fontWeight: '700' }}>Chat with {phoneCandidate}</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.sectionTitle}>CONVERSATIONS</Text>
          {loading ? (
            <LoadingState label="Loading conversations…" />
          ) : (
            <FlatList
              data={conversations}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <Text style={styles.empty}>No conversations yet. Search for someone to start chatting.</Text>
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
    list: { paddingBottom: 24 },
    empty: { color: colors.muted, textAlign: 'center', marginTop: 40, marginHorizontal: 30, lineHeight: 20 },
  });
}
