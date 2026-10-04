import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';

import { getConversationMedia } from '../api';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { ImageViewerModal } from '../components/ImageViewerModal';
import { LoadingState } from '../components/ui';
import { downloadAttachment } from '../components/MessageBubble';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';
import { fmtDay, fmtTime } from '../utils/formatting';

const TABS = [
  ['media', 'Media'],
  ['links', 'Links'],
  ['docs', 'Docs'],
];

/** "Media, links and docs" gallery for one conversation (web parity). */
export function SharedMediaScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const conversation = route.params?.conversation;
  const { width } = useWindowDimensions();

  const [media, setMedia] = useState([]);
  const [links, setLinks] = useState([]);
  const [tab, setTab] = useState('media');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState(null);

  const load = useCallback(async () => {
    if (!conversation?.id) return;
    try {
      const data = await getConversationMedia(conversation.id);
      setMedia(data?.media || []);
      setLinks(data?.links || []);
      setError('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, [conversation?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const images = media.filter((m) => m.message_type === 'image');
  const docs = media.filter((m) => m.message_type !== 'image');
  const title = conversation?.kind === 'group' ? conversation.name : 'Chat';
  const styles = makeStyles(colors, accent);

  const tileSize = (width - 4) / 3;

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Media, links & docs</Text>
          <Text style={[styles.headerSub, { color: colors.muted }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {TABS.map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, tab === key && { backgroundColor: accent }]}
            onPress={() => setTab(key)}
          >
            <Text style={[styles.tabText, { color: tab === key ? '#071d22' : colors.text }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

      {loading ? (
        <LoadingState label="Loading shared content…" />
      ) : tab === 'media' ? (
        images.length === 0 ? (
          <Text style={styles.empty}>No photos shared in this chat yet.</Text>
        ) : (
          <FlatList
            data={images}
            keyExtractor={(item) => String(item.id)}
            numColumns={3}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => (
              <TouchableOpacity style={{ width: tileSize, height: tileSize, padding: 1 }} onPress={() => setViewer(item)}>
                <AuthenticatedImage uri={item.attachment_url} style={styles.thumb} />
              </TouchableOpacity>
            )}
          />
        )
      ) : tab === 'links' ? (
        links.length === 0 ? (
          <Text style={styles.empty}>No links shared in this chat yet.</Text>
        ) : (
          <FlatList
            data={links}
            keyExtractor={(item, index) => `${item.message_id}-${index}`}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.linkCard, { backgroundColor: colors.surface }]}
                onPress={() => Linking.openURL(item.url).catch(() => {})}
              >
                <Text style={[styles.linkUrl, { color: accent }]} numberOfLines={2}>
                  {item.url}
                </Text>
                <Text style={[styles.linkMeta, { color: colors.muted }]}>
                  {item.sender} · {fmtDay(item.created_at)}
                </Text>
              </TouchableOpacity>
            )}
          />
        )
      ) : docs.length === 0 ? (
        <Text style={styles.empty}>No files or voice notes shared in this chat yet.</Text>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.docCard, { backgroundColor: colors.surface }]}
              onPress={() => downloadAttachment(item)}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.docName, { color: colors.text }]} numberOfLines={2}>
                  {item.attachment_name || item.body || 'Attachment'}
                </Text>
                <Text style={[styles.docMeta, { color: colors.muted }]}>
                  {item.sender?.display_name} · {fmtDay(item.created_at)} {fmtTime(item.created_at)}
                </Text>
              </View>
              <Text style={{ fontSize: 18 }}>⬇</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <ImageViewerModal
        visible={Boolean(viewer)}
        uri={viewer?.attachment_url}
        name={viewer?.attachment_name}
        onClose={() => setViewer(null)}
        onDownload={() => viewer && downloadAttachment(viewer)}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors, accent) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
    backText: { fontSize: 22 },
    headerTitle: { fontSize: 20, fontWeight: '800' },
    headerSub: { fontSize: 12.5, marginTop: 1 },
    tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
    tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999 },
    tabText: { fontSize: 13, fontWeight: '700' },
    grid: { padding: 1 },
    thumb: { flex: 1, borderRadius: 6 },
    list: { padding: 12, paddingBottom: 28 },
    linkCard: { borderRadius: 12, padding: 12, marginBottom: 8 },
    linkUrl: { fontSize: 14, fontWeight: '600' },
    linkMeta: { fontSize: 11.5, marginTop: 4 },
    docCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12, marginBottom: 8, gap: 10 },
    docName: { fontSize: 14, fontWeight: '600' },
    docMeta: { fontSize: 11.5, marginTop: 3 },
    error: { fontSize: 12.5, paddingHorizontal: 16, paddingVertical: 4 },
    empty: { color: colors.muted, textAlign: 'center', marginTop: 48, marginHorizontal: 30, lineHeight: 20 },
  });
}
