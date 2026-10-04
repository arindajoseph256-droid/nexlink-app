import React, { useCallback, useContext, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { getCallHistory, getConversations } from '../api';
import { Avatar, LoadingState } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';
import { fmtDay, fmtTime } from '../utils/formatting';

function fmtDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Call history (web parity: calls list). */
export function CallHistoryScreen() {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await getCallHistory();
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

  async function openChat(conversationId) {
    if (!conversationId) return;
    try {
      const data = await getConversations();
      const list = Array.isArray(data) ? data : data.results || [];
      const conversation = list.find((item) => String(item.id) === String(conversationId));
      if (conversation) navigation.navigate('Chat', { conversation });
    } catch {}
  }

  const styles = makeStyles(colors);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Call history</Text>
      </View>

      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

      {loading ? (
        <LoadingState label="Loading calls…" />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No calls yet. Start one from a chat.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => openChat(item.conversation)}>
              <Avatar name={item.peer?.display_name} uri={item.peer?.avatar_url} size={42} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                  {item.peer?.display_name || 'Unknown'}
                </Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {item.direction === 'outgoing' ? '↗ Outgoing' : '↙ Incoming'} · {item.kind} · {item.status}
                </Text>
              </View>
              <View style={styles.right}>
                <Text style={[styles.duration, { color: colors.muted }]}>{fmtDuration(item.duration_seconds)}</Text>
                <Text style={[styles.when, { color: colors.muted }]}>
                  {fmtDay(item.created_at)} {fmtTime(item.created_at)}
                </Text>
              </View>
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
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
    name: { fontSize: 15, fontWeight: '600' },
    meta: { fontSize: 12.5, marginTop: 2, textTransform: 'capitalize' },
    right: { alignItems: 'flex-end' },
    duration: { fontSize: 13, fontWeight: '700' },
    when: { fontSize: 11, marginTop: 2 },
    error: { fontSize: 12.5, paddingHorizontal: 16, paddingVertical: 4 },
    empty: { color: colors.muted, textAlign: 'center', marginTop: 48, marginHorizontal: 30, lineHeight: 20 },
  });
}
