import React, { useCallback, useContext, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { getConversations, getStarredMessages, starMessage } from '../api';
import { LoadingState } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';
import { fmtDay, fmtTime } from '../utils/formatting';

/** Every message the viewer starred, across all conversations (web parity). */
export function StarredMessagesScreen() {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await getStarredMessages();
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

  /* Single-GET conversations are not part of the API — resolve via the list. */
  async function openChat(conversationId) {
    try {
      const data = await getConversations();
      const list = Array.isArray(data) ? data : data.results || [];
      const conversation = list.find((item) => String(item.id) === String(conversationId));
      if (conversation) navigation.navigate('Chat', { conversation });
      else Alert.alert('Nexlink', 'That conversation is no longer available.');
    } catch (err) {
      Alert.alert('Nexlink', friendlyError(err));
    }
  }

  async function unstar(message) {
    try {
      await starMessage(message.id);
      setResults((current) => current.filter((item) => item.id !== message.id));
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  const styles = makeStyles(colors, accent);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Starred messages</Text>
      </View>

      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

      {loading ? (
        <LoadingState label="Loading starred messages…" />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No starred messages yet. Long-press a message in any chat and tap ★ Star to keep it here.
            </Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, { backgroundColor: colors.surface }]}
              onPress={() => openChat(item.conversation)}
            >
              <Text style={[styles.sender, { color: accent }]}>
                {item.sender?.display_name || 'Unknown'} · {fmtDay(item.created_at)}
              </Text>
              <Text style={[styles.body, { color: colors.text }]} numberOfLines={3}>
                {item.is_deleted ? '🚫 Message deleted' : item.body || item.attachment_name || 'Attachment'}
              </Text>
              <View style={styles.cardFooter}>
                <Text style={[styles.time, { color: colors.muted }]}>{fmtTime(item.created_at)}</Text>
                <TouchableOpacity onPress={() => unstar(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={[styles.unstar, { color: accent }]}>★ Remove</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors, accent) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
    backText: { fontSize: 22 },
    headerTitle: { fontSize: 20, fontWeight: '800' },
    list: { padding: 12, paddingBottom: 28 },
    card: { borderRadius: 14, padding: 14, marginBottom: 10 },
    sender: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
    body: { fontSize: 15, lineHeight: 20 },
    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
    time: { fontSize: 11.5 },
    unstar: { fontSize: 12.5, fontWeight: '700' },
    error: { fontSize: 12.5, paddingHorizontal: 16, paddingVertical: 4 },
    empty: { color: colors.muted, textAlign: 'center', marginTop: 48, marginHorizontal: 30, lineHeight: 20 },
  });
}
