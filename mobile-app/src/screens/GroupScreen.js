import React, { useContext, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { createGroup } from '../api/groups';
import { getChatPeople } from '../api/groups';
import { Avatar, ErrorText } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

export function GroupScreen({ user }) {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getChatPeople()
      .then((data) => setPeople(data.results || data || []))
      .catch((err) => setError(friendlyError(err)));
  }, []);

  function togglePerson(id) {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  async function create() {
    if (!name.trim()) {
      setError('Give the group a name.');
      return;
    }
    if (!selected.length) {
      setError('Pick at least one member.');
      return;
    }
    setBusy(true);
    try {
      const group = await createGroup(name.trim(), selected);
      navigation.replace('Chat', { conversation: group });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const styles = makeStyles(colors, accent);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>New group</Text>
      </View>
      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.muted }]}>Group name</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Weekend plans"
          placeholderTextColor={colors.muted}
        />
        <Text style={[styles.label, { color: colors.muted }]}>
          Members ({selected.length} selected)
        </Text>
      </View>
      <FlatList
        data={people}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => {
          const isPicked = selected.includes(item.id);
          return (
            <TouchableOpacity style={styles.personRow} onPress={() => togglePerson(item.id)}>
              <Avatar name={item.display_name} uri={item.avatar_url} size={36} online={item.is_online} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{item.display_name}</Text>
              </View>
              <View
                style={[styles.checkbox, { borderColor: isPicked ? accent : colors.border, backgroundColor: isPicked ? accent : 'transparent' }]}
              >
                {isPicked ? <Text style={{ color: '#071d22', fontWeight: '900' }}>✓</Text> : null}
              </View>
            </TouchableOpacity>
          );
        }}
      />
      <ErrorText message={error} />
      <TouchableOpacity onPress={create} disabled={busy} style={[styles.createButton, { backgroundColor: accent }]}>
        <Text style={styles.createText}>{busy ? 'Creating…' : 'Create group'}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function makeStyles(colors, accent) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
    backText: { fontSize: 22 },
    headerTitle: { fontSize: 20, fontWeight: '800' },
    form: { paddingHorizontal: 16 },
    label: { fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
    personRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
    checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    createButton: { margin: 16, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
    createText: { color: '#071d22', fontWeight: '800', fontSize: 15 },
  });
}
