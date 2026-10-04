import React, { useContext, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { getPreferences, updatePreferences } from '../api/settings';
import { ErrorText, SettingsSwitch, SectionTitle } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

/* Same presence flow as the web status picker. */
const STATUSES = [
  ['available', 'Available'],
  ['busy', 'Busy'],
  ['away', 'Away'],
  ['dnd', 'Do not disturb'],
  ['invisible', 'Invisible'],
];

export function PrivacySettingsScreen() {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getPreferences()
      .then(setPrefs)
      .catch((err) => setError(friendlyError(err)));
  }, []);

  async function toggle(key) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      const saved = await updatePreferences({ [key]: next[key] });
      setPrefs((current) => ({ ...current, ...saved }));
      setError('');
    } catch (err) {
      setPrefs(prefs);
      setError(friendlyError(err));
    }
  }

  async function pickStatus(status) {
    const previous = prefs.status;
    setPrefs((current) => ({ ...current, status }));
    try {
      const saved = await updatePreferences({ status });
      setPrefs((current) => ({ ...current, ...saved }));
      setError('');
    } catch (err) {
      setPrefs((current) => ({ ...current, status: previous }));
      setError(friendlyError(err));
    }
  }

  const styles = makeStyles(colors);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Privacy</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {prefs ? (
          <>
            <SectionTitle>Visibility</SectionTitle>
            <SettingsSwitch
              label="Read receipts"
              description="Let others know when you've read their messages"
              value={prefs.read_receipts}
              onValueChange={() => toggle('read_receipts')}
            />
            <SettingsSwitch
              label="Typing indicator"
              description="Show when you're typing"
              value={prefs.typing_indicator}
              onValueChange={() => toggle('typing_indicator')}
            />
            <SettingsSwitch
              label="Last seen"
              description="Show when you were last online"
              value={prefs.last_seen_visible}
              onValueChange={() => toggle('last_seen_visible')}
            />

            <SectionTitle>Presence status</SectionTitle>
            <View style={styles.statusWrap}>
              {STATUSES.map(([key, label]) => {
                const active = prefs.status === key;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.statusChip,
                      {
                        backgroundColor: active ? accent : colors.surface,
                        borderColor: active ? accent : colors.border,
                      },
                    ]}
                    onPress={() => pickStatus(key)}
                  >
                    <Text style={{ color: active ? '#071d22' : colors.text, fontWeight: '700', fontSize: 13 }}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : (
          <Text style={{ color: colors.muted, paddingHorizontal: 16, paddingTop: 12 }}>Loading…</Text>
        )}
        <ErrorText message={error} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
    backText: { fontSize: 22 },
    headerTitle: { fontSize: 20, fontWeight: '800' },
    body: { paddingBottom: 32 },
    statusWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingTop: 4 },
    statusChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  });
}
