import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';

import {
  addGroupMember,
  getGroupDetail,
  leaveGroup,
  promoteGroupAdmin,
  removeGroupMember,
  searchUsers,
  updateGroup,
} from '../api';
import { Avatar, ErrorText, LoadingState, SectionTitle } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

/** Group admin: rename/description, add/remove members, promote admins. */
export function GroupAdminScreen({ user }) {
  const navigation = useNavigation();
  const route = useRoute();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const conversation = route.params?.conversation;

  const [group, setGroup] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!conversation?.id) return;
    try {
      const data = await getGroupDetail(conversation.id);
      setGroup(data);
      setName(data.name || '');
      setDescription(data.description || '');
      setError('');
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [conversation?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const iAmAdmin = Boolean(
    group?.participants?.find((member) => member.id === user?.id)?.is_admin,
  );

  async function searchMember(text) {
    setMemberQuery(text);
    if (!text.trim()) return setSuggestions([]);
    try {
      const data = await searchUsers(text);
      setSuggestions(data.results || []);
    } catch {}
  }

  async function addMember(person) {
    setBusy(true);
    try {
      const data = await addGroupMember(conversation.id, person.id);
      setGroup(data);
      setMemberQuery('');
      setSuggestions([]);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function memberActions(member) {
    if (member.id === user?.id) {
      Alert.alert('You', 'This is you — use Leave group to exit.', [{ text: 'OK', style: 'cancel' }]);
      return;
    }
    const options = [];
    if (iAmAdmin && !member.is_admin) {
      options.push({
        text: '⭐ Promote to admin',
        onPress: () => runMemberAction(() => promoteGroupAdmin(conversation.id, member.id)),
      });
    }
    if (iAmAdmin || member.id === user?.id) {
      options.push({
        text: 'Remove from group',
        style: 'destructive',
        onPress: () =>
          runMemberAction(async () => {
            await removeGroupMember(conversation.id, member.id);
            await load();
          }),
      });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    if (!options.length) return;
    Alert.alert(member.display_name, undefined, options);
  }

  async function runMemberAction(action) {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails() {
    setBusy(true);
    setSaved(false);
    try {
      const data = await updateGroup(conversation.id, {
        name: name.trim(),
        description: description.trim(),
      });
      setGroup(data);
      setSaved(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmLeave() {
    Alert.alert('Leave group', `Leave “${group?.name || 'this group'}”?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveGroup(conversation.id);
            navigation.goBack();
          } catch (err) {
            setError(friendlyError(err));
          }
        },
      },
    ]);
  }

  const styles = makeStyles(colors, accent);

  if (!group) {
    return (
      <SafeAreaView style={styles.page}>
        <Header navigation={navigation} title="Group settings" colors={colors} />
        {error ? <ErrorText message={error} /> : <LoadingState label="Loading group…" />}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <Header navigation={navigation} title="Group settings" colors={colors} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <SectionTitle>Group info</SectionTitle>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.label, { color: colors.muted }]}>Name</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
            value={name}
            onChangeText={setName}
            editable={iAmAdmin}
          />
          <Text style={[styles.label, { color: colors.muted }]}>Description</Text>
          <TextInput
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg, minHeight: 64 },
            ]}
            value={description}
            onChangeText={setDescription}
            multiline
            editable={iAmAdmin}
          />
          {iAmAdmin ? (
            <TouchableOpacity
              onPress={saveDetails}
              disabled={busy || !name.trim()}
              style={[styles.saveButton, { backgroundColor: accent, opacity: busy || !name.trim() ? 0.6 : 1 }]}
            >
              <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save group info'}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.hint, { color: colors.muted }]}>Only group admins can edit group info.</Text>
          )}
          {saved ? <Text style={{ color: colors.success, fontWeight: '700' }}>Saved ✓</Text> : null}
        </View>

        <SectionTitle>Members ({group.participants?.length || 0})</SectionTitle>
        {iAmAdmin && (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.label, { color: colors.muted }]}>Add a member</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
              value={memberQuery}
              onChangeText={searchMember}
              placeholder="Search by name, phone or email…"
              placeholderTextColor={colors.muted}
            />
            {suggestions.map((person) => (
              <TouchableOpacity key={person.id} style={styles.suggestionRow} onPress={() => addMember(person)}>
                <Avatar name={person.display_name} uri={person.avatar_url} size={32} />
                <Text style={{ color: colors.text, flex: 1, marginLeft: 10 }}>{person.display_name}</Text>
                <Text style={{ color: accent, fontWeight: '700' }}>Add</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <FlatList
          scrollEnabled={false}
          data={group.participants || []}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.memberRow} onPress={() => memberActions(item)}>
              <Avatar name={item.display_name} uri={item.avatar_url} size={38} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>
                  {item.display_name}
                  {item.id === user?.id ? ' (you)' : ''}
                </Text>
                {item.is_admin ? (
                  <Text style={{ color: accent, fontSize: 11.5, marginTop: 2 }}>Group admin</Text>
                ) : null}
              </View>
              <Text style={{ color: colors.muted, fontSize: 18 }}>⋮</Text>
            </TouchableOpacity>
          )}
        />

        <ErrorText message={error} />

        <TouchableOpacity style={styles.leaveButton} onPress={confirmLeave}>
          <Text style={styles.leaveText}>Leave group</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ navigation, title, colors }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 }}>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={{ fontSize: 22, color: colors.text }}>←</Text>
      </TouchableOpacity>
      <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{title}</Text>
    </View>
  );
}

function makeStyles(colors, accent) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    body: { paddingBottom: 32 },
    card: { borderRadius: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, marginHorizontal: 12, marginBottom: 6 },
    label: {
      fontSize: 12,
      fontWeight: '700',
      marginTop: 8,
      marginBottom: 6,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
    saveButton: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
    saveText: { color: '#071d22', fontWeight: '800', fontSize: 14.5 },
    hint: { fontSize: 12.5, marginTop: 10 },
    suggestionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 4,
    },
    leaveButton: {
      marginHorizontal: 12,
      marginTop: 18,
      borderRadius: 14,
      paddingVertical: 13,
      alignItems: 'center',
      backgroundColor: colors.dangerSoft,
    },
    leaveText: { color: colors.danger, fontWeight: '800', fontSize: 15 },
  });
}
