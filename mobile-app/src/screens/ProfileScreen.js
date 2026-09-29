import React, { useContext, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { getMe, updateProfile } from '../api/auth';
import { ErrorText } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

export function ProfileScreen({ user, onUserUpdated }) {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [about, setAbout] = useState(user?.about || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const data = await updateProfile({ display_name: displayName.trim(), about: about.trim() });
      onUserUpdated?.(data);
      setSaved(true);
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Your profile</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.hero}>
          <View style={styles.heroCard}>
            <View style={[styles.avatarFallback, { backgroundColor: accent }]}>
              <Text style={styles.avatarText}>
                {(displayName || '?').slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <Text style={[styles.heroName, { color: colors.text }]}>{displayName || 'Your name'}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{user?.phone_number}</Text>
            {saved ? <Text style={{ color: colors.success, marginTop: 6, fontWeight: '700' }}>Saved ✓</Text> : null}
          </View>
        </View>

        <Text style={[styles.label, { color: colors.muted }]}>Display name</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={displayName}
          onChangeText={setDisplayName}
        />
        <Text style={[styles.label, { color: colors.muted }]}>About</Text>
        <TextInput
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface, minHeight: 70 },
          ]}
          value={about}
          onChangeText={setAbout}
          placeholder="Available on Nexlink"
          placeholderTextColor={colors.muted}
          multiline
        />
        <ErrorText message={error} />
        <TouchableOpacity onPress={save} disabled={busy} style={[styles.saveButton, { backgroundColor: accent }]}>
          <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save changes'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors, accent) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
    backText: { fontSize: 22 },
    headerTitle: { fontSize: 17, fontWeight: '800' },
    body: { padding: 16 },
    hero: { alignItems: 'center', marginVertical: 12 },
    heroCard: { alignItems: 'center', gap: 6 },
    avatarFallback: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#071d22', fontSize: 32, fontWeight: '800' },
    heroName: { fontSize: 18, fontWeight: '800' },
    label: { fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
    saveButton: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 20 },
    saveText: { color: '#071d22', fontWeight: '800', fontSize: 15 },
  });
}
