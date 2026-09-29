import React, { useContext, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { getPreferences, updatePreferences } from '../api/settings';
import { ErrorText, SettingsSwitch, SectionTitle } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

export function NotificationSettingsScreen() {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
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
      setPrefs(prefs); // revert on failure
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Notifications</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {prefs ? (
          <>
            <SectionTitle>Messages</SectionTitle>
            <SettingsSwitch
              label="Message notifications"
              description="Show notifications for new messages"
              value={prefs.notifications}
              onValueChange={() => toggle('notifications')}
            />
            <SettingsSwitch
              label="Sounds"
              description="Play a sound for incoming messages"
              value={prefs.sounds}
              onValueChange={() => toggle('sounds')}
            />
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
  });
}
