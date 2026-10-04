import React, { useCallback, useContext, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { getContacts, removeContact, startConversation } from '../api';
import { Avatar, LoadingState } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

/** Saved contacts list (web parity: contacts panel). */
export function ContactsScreen() {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await getContacts();
      setResults(data?.results || []);
      setError('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function openChat(contact) {
    try {
      const conversation = await startConversation(contact.contact_id);
      navigation.navigate('Chat', { conversation });
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  function confirmRemove(contact) {
    Alert.alert('Remove contact', `Remove ${contact.display_name} from your contacts?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeContact(contact.contact_id);
            setResults((current) => current.filter((item) => item.id !== contact.id));
          } catch (err) {
            setError(friendlyError(err));
          }
        },
      },
    ]);
  }

  const styles = makeStyles(colors);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Contacts</Text>
      </View>

      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

      {loading ? (
        <LoadingState label="Loading contacts…" />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No contacts saved yet. Add people from the search bar on the chats screen — shared contacts
              appear here.
            </Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => openChat(item)}>
              <Avatar name={item.display_name} uri={item.avatar_url} size={42} />
              <View style={styles.rowText}>
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                  {item.display_name}
                </Text>
                <Text style={[styles.sub, { color: colors.muted }]} numberOfLines={1}>
                  {item.nickname ? `${item.nickname} · ` : ''}Tap to chat
                </Text>
              </View>
              <TouchableOpacity onPress={() => confirmRemove(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.remove, { color: colors.danger }]}>Remove</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
    backText: { fontSize: 22 },
    headerTitle: { fontSize: 20, fontWeight: '800' },
    list: { paddingVertical: 8, paddingBottom: 28 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 12,
    },
    rowText: { flex: 1 },
    name: { fontSize: 15, fontWeight: '600' },
    sub: { fontSize: 12.5, marginTop: 2 },
    remove: { fontSize: 12.5, fontWeight: '700' },
    error: { fontSize: 12.5, paddingHorizontal: 16, paddingVertical: 4 },
    empty: { color: colors.muted, textAlign: 'center', marginTop: 48, marginHorizontal: 30, lineHeight: 20 },
  });
}
