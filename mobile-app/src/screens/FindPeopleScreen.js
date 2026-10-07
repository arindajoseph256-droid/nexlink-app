import React, { useCallback, useContext, useState } from 'react';
import {
  ActivityIndicator, FlatList, Linking, Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { discoverContacts, getPeopleSuggestions, startConversation } from '../api';
import { Avatar } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

let Sharing = null;
try {
  Sharing = require('expo-sharing');
} catch {}

const INVITE_TEXT = 'Join me on Nexlink. Download Nexlink and chat with me. https://nexlink-app.onrender.com';

function sourceLabel(person) {
  const sources = person.sources || [];
  if (sources.includes('phone')) return 'From your contacts';
  if (sources.includes('email')) return 'From your contacts (email)';
  if (person.is_contact) return 'From your NEXLINK contacts';
  if ((person.mutual_contacts || 0) > 0) {
    return `${person.mutual_contacts} mutual contact${person.mutual_contacts === 1 ? '' : 's'}`;
  }
  if ((person.shared_groups || 0) > 0) {
    return person.shared_groups === 1 ? 'Shared group' : `Member of ${person.shared_groups} groups with you`;
  }
  if (person.source === 'nexlink') return 'You may know each other';
  return 'On NEXLINK';
}

export function FindPeopleScreen() {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';

  const [suggestions, setSuggestions] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [openChatId, setOpenChatId] = useState(null);

  const loadSuggestions = useCallback(async () => {
    try {
      const data = await getPeopleSuggestions(20);
      setSuggestions(data?.results || []);
      setError('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  async function syncPhoneContacts() {
    setSyncing(true);
    setPermissionDenied(false);
    setError('');
    try {
      const data = await discoverContacts({ source: 'phone_contacts' });
      if (data.error === 'denied') {
        setPermissionDenied(true);
      } else if (data.error) {
        setError(data.error === 'unavailable'
          ? 'Contacts are not available on this device.'
          : friendlyError(new Error(data.error)));
      } else {
        setMatches(data.results || []);
        setLastSynced(new Date());
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSyncing(false);
    }
  }

  async function openChat(person) {
    setOpenChatId(person.id);
    try {
      const conversation = await startConversation(person.id);
      navigation.navigate('Chat', { conversation });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setOpenChatId(null);
    }
  }

  async function inviteContact(name) {
    if (Sharing && (await Sharing.isAvailableAsync())) {
      try {
        await Sharing.shareAsync(INVITE_TEXT.startsWith('http') ? INVITE_TEXT : INVITE_TEXT, {
          dialogTitle: 'Invite to Nexlink',
          mimeType: 'text/plain',
        });
        return;
      } catch {}
    }
    try {
      await Linking.openURL(`sms:?&body=${encodeURIComponent(INVITE_TEXT)}`);
    } catch {}
  }

  const styles = makeStyles(colors);

  const renderPerson = (person, isMatch) => (
    <View style={styles.row} key={`${person.id}-${isMatch ? 'm' : 's'}`}>
      <Avatar name={person.display_name} uri={person.avatar_url} size={42} />
      <View style={styles.rowText}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {person.display_name}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]} numberOfLines={1}>
          {sourceLabel(person)}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.chatBtn, { backgroundColor: accent }]}
        onPress={() => openChat(person)}
        disabled={openChatId === person.id}
      >
        {openChatId === person.id
          ? <ActivityIndicator size="small" color="#071d22" />
          : <Text style={styles.chatBtnText}>Chat</Text>}
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Find People</Text>
      </View>

      <FlatList
        data={suggestions}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshing={syncing}
        onRefresh={syncPhoneContacts}
        ListHeaderComponent={(
          <View>
            {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

            {permissionDenied ? (
              <View style={[styles.card, { borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Contacts permission needed</Text>
                <Text style={[styles.cardBody, { color: colors.muted }]}>
                  Nexlink uses your address book only to find people you already know who are on
                  Nexlink. Your contact list is never stored or shared. You can change this anytime
                  in Android Settings → Apps → Nexlink → Permissions.
                </Text>
                <TouchableOpacity style={[styles.retryBtn, { borderColor: accent }]} onPress={syncPhoneContacts}>
                  <Text style={{ color: accent, fontWeight: '700' }}>Grant permission & sync</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Linking.openSettings()}>
                  <Text style={[styles.openSettings, { color: colors.muted }]}>Open Android settings</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.syncBtn, { borderColor: accent }]}
              onPress={syncPhoneContacts}
              disabled={syncing}
            >
              {syncing
                ? <ActivityIndicator size="small" color={accent} />
                : <Text style={{ color: accent, fontWeight: '800' }}>📱 Find people from my contacts</Text>}
            </TouchableOpacity>
            {lastSynced ? (
              <Text style={[styles.syncedAt, { color: colors.muted }]}>
                Last synced: {lastSynced.toLocaleTimeString()}
              </Text>
            ) : null}

            {matches.length > 0 ? (
              <Text style={[styles.sectionTitle, { color: colors.muted }]}>CONTACTS ON NEXLINK</Text>
            ) : null}
            {matches.map((p) => renderPerson(p, true))}

            {suggestions.length > 0 ? (
              <Text style={[styles.sectionTitle, { color: colors.muted }]}>PEOPLE YOU MAY KNOW</Text>
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <Text style={[styles.empty, { color: colors.muted }]}>Loading suggestions…</Text>
          ) : (
            <Text style={[styles.empty, { color: colors.muted }]}>
              No suggestions yet. Sync your contacts or start chatting — people you share groups and
              contacts with will appear here.
            </Text>
          )
        }
        renderItem={({ item }) => renderPerson(item, false)}
        ListFooterComponent={(
          <View>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>INVITE FRIENDS</Text>
            <View style={styles.row}>
              <Avatar name="Invite" size={42} />
              <View style={styles.rowText}>
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>Invite a friend to Nexlink</Text>
                <Text style={[styles.sub, { color: colors.muted }]}>Share a link — never auto-sent</Text>
              </View>
              <TouchableOpacity
                style={[styles.chatBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
                onPress={inviteContact}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Invite</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
    backText: { fontSize: 22 },
    headerTitle: { fontSize: 20, fontWeight: '800' },
    list: { paddingBottom: 28 },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
    rowText: { flex: 1 },
    name: { fontSize: 15, fontWeight: '600' },
    sub: { fontSize: 12.5, marginTop: 2 },
    chatBtn: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
    chatBtnText: { color: '#071d22', fontWeight: '800', fontSize: 13 },
    syncBtn: {
      borderWidth: 1.5, borderRadius: 14, marginHorizontal: 16, marginTop: 8,
      paddingVertical: 12, alignItems: 'center',
    },
    syncedAt: { fontSize: 11.5, textAlign: 'center', marginTop: 6 },
    sectionTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, paddingHorizontal: 16, marginTop: 18, marginBottom: 2 },
    error: { fontSize: 12.5, paddingHorizontal: 16, paddingVertical: 4 },
    empty: { textAlign: 'center', marginTop: 48, marginHorizontal: 30, lineHeight: 20 },
    card: { borderWidth: 1, borderRadius: 14, marginHorizontal: 16, marginTop: 12, padding: 14 },
    cardTitle: { fontWeight: '800', fontSize: 14, marginBottom: 4 },
    cardBody: { fontSize: 12.5, lineHeight: 18 },
    retryBtn: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 9, alignItems: 'center', marginTop: 10 },
    openSettings: { fontSize: 12, textAlign: 'center', marginTop: 10 },
  });
}
