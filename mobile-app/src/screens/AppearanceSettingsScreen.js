import React, { useContext, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { getPreferences, updatePreferences } from '../api/settings';
import { ErrorText, SettingsRow, SectionTitle } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

const THEME_OPTIONS = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'System' },
];

export function AppearanceSettingsScreen() {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [error, setError] = useState('');
  const [synced, setSynced] = useState(true);

  /* Pull server preferences on open so web-chosen themes show here. */
  useEffect(() => {
    getPreferences()
      .then((prefs) => {
        if (prefs.theme && ['light', 'dark', 'system'].includes(prefs.theme)) {
          theme?.setTheme?.(prefs.theme);
        }
        if (prefs.accent) theme?.applyAccent?.(prefs.accent);
      })
      .catch(() => setSynced(false));
  }, []);

  async function chooseTheme(next) {
    theme?.setTheme?.(next);
    try {
      await updatePreferences({ theme: next });
      setError('');
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function chooseAccentColor(hex) {
    theme?.applyAccent?.(hex);
    try {
      await updatePreferences({ accent: hex });
      setError('');
    } catch (err) {
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Appearance</Text>
      </View>

      <View style={styles.body}>
        <SectionTitle>Theme</SectionTitle>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.key}
              onPress={() => chooseTheme(option.key)}
              style={[
                styles.themeOption,
                { backgroundColor: colors.surface, borderColor: theme?.themePref === option.key ? accent : colors.border },
              ]}
            >
              <Text style={{ color: colors.text, fontWeight: theme?.themePref === option.key ? '800' : '500' }}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <SectionTitle>Accent colour</SectionTitle>
        <View style={styles.accentWrap}>
          {(theme?.accentChoices || []).map((hex) => (
            <TouchableOpacity
              key={hex}
              onPress={() => chooseAccentColor(hex)}
              style={[styles.accentDot, { backgroundColor: hex, borderColor: accent === hex ? colors.text : 'transparent' }]}
            >
              {accent === hex ? <Text style={styles.accentCheck}>✓</Text> : null}
            </TouchableOpacity>
          ))}
        </View>

        <SectionTitle>Preview</SectionTitle>
        <SettingsRow
          label="Chat bubble preview"
          description="Theme changes apply across the whole app"
          right={<View style={[styles.previewBubble, { backgroundColor: colors.bubbleOut }]} />}
        />
        <ErrorText message={error} />
        {!synced ? (
          <Text style={{ color: colors.muted, fontSize: 12, paddingHorizontal: 16 }}>
            Couldn't reach the server — theme saved on this device and will sync later.
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
    backText: { fontSize: 22 },
    headerTitle: { fontSize: 20, fontWeight: '800' },
    body: { paddingVertical: 8 },
    themeRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, marginTop: 4 },
    themeOption: {
      flex: 1,
      borderWidth: 2,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
    },
    accentWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 20, marginTop: 8 },
    accentDot: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
    accentCheck: { color: '#071d22', fontWeight: '900', fontSize: 16 },
    previewBubble: { width: 70, height: 28, borderRadius: 14 },
  });
}
