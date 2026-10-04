import React, { useContext, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { changeEmail, emailAccountBackup, getAccountBackup } from '../api/auth';
import { ErrorText, SectionTitle } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

let FileSystem = null;
let Sharing = null;
try {
  FileSystem = require('expo-file-system');
} catch {}
try {
  Sharing = require('expo-sharing');
} catch {}

/**
 * Recovery email + account backup.
 *
 * The recovery email doubles as the backup destination: it is the address
 * password resets go to and the address `Email backup` delivers the JSON
 * export to. The same export can be saved locally via the share sheet.
 */
export function RecoveryBackupScreen({ user, onUserUpdated }) {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [email, setEmail] = useState(user?.email || '');
  const [busy, setBusy] = useState(''); // '' | 'email' | 'download'
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function saveEmail() {
    setBusy('email-save');
    setError('');
    setSaved(false);
    try {
      const data = await changeEmail(email.trim());
      onUserUpdated?.({ email: data.email });
      setSaved(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function downloadBackup() {
    setBusy('download');
    setError('');
    try {
      const backup = await getAccountBackup();
      const json = JSON.stringify(backup, null, 2);
      if (!FileSystem?.writeAsStringAsync) {
        Alert.alert('Backup ready', 'The file module is unavailable in this build — use Email backup instead.');
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const uri = `${FileSystem.documentDirectory}nexlink-backup-${stamp}.json`;
      await FileSystem.writeAsStringAsync(uri, json);
      if (Sharing && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/json',
          dialogTitle: 'Save your Nexlink backup',
        });
      } else {
        Alert.alert('Backup saved', uri);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function emailBackup() {
    if (!user?.email && !email.trim()) {
      setError('Set a recovery email first.');
      return;
    }
    setBusy('email');
    setError('');
    try {
      const data = await emailAccountBackup();
      if (data.console_backend) {
        Alert.alert(
          'Backup requested',
          `The server has no mail service configured yet, so nothing was delivered to ${data.email}. ` +
            'Use Download backup to save the file instead.',
        );
      } else {
        Alert.alert('Backup sent', `Your account backup was emailed to ${data.email}.`);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  const styles = makeStyles(colors, accent);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Recovery & backup</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <SectionTitle>Recovery email</SectionTitle>
        <Text style={[styles.label, { color: colors.muted }]}>Email address</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setSaved(false);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="you@example.com"
          placeholderTextColor={colors.muted}
        />
        <Text style={[styles.note, { color: colors.muted }]}>
          Used for password resets and for receiving your account backups.
        </Text>
        <TouchableOpacity
          onPress={saveEmail}
          disabled={busy === 'email-save' || !email.trim()}
          style={[styles.button, { backgroundColor: accent, opacity: busy === 'email-save' ? 0.6 : 1 }]}
        >
          <Text style={styles.buttonText}>
            {busy === 'email-save' ? 'Saving…' : 'Save recovery email'}
          </Text>
        </TouchableOpacity>
        {saved ? <Text style={{ color: colors.success, fontWeight: '700', paddingHorizontal: 4 }}>Saved ✓</Text> : null}

        <SectionTitle>Account backup</SectionTitle>
        <Text style={[styles.note, { color: colors.muted, marginTop: 0 }]}>
          Your backup is a JSON file with your profile, settings, contacts, starred messages and recent
          conversation history. Photos and files you shared are listed with download paths, not embedded.
        </Text>

        <TouchableOpacity
          onPress={downloadBackup}
          disabled={Boolean(busy)}
          style={[styles.button, { backgroundColor: accent, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={styles.buttonText}>
            {busy === 'download' ? 'Preparing…' : 'Download backup file'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={emailBackup}
          disabled={Boolean(busy)}
          style={[styles.secondaryButton, { borderColor: accent, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={[styles.secondaryText, { color: accent }]}>
            {busy === 'email' ? 'Sending…' : 'Email backup to recovery email'}
          </Text>
        </TouchableOpacity>

        <ErrorText message={error} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors, accent) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
    backText: { fontSize: 22 },
    headerTitle: { fontSize: 20, fontWeight: '800' },
    body: { padding: 12, paddingBottom: 32 },
    label: {
      fontSize: 12,
      fontWeight: '700',
      marginTop: 12,
      marginBottom: 6,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
    note: { fontSize: 12, marginTop: 10, marginBottom: 4, lineHeight: 18 },
    button: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 14 },
    buttonText: { color: '#071d22', fontWeight: '800', fontSize: 15 },
    secondaryButton: {
      borderRadius: 12,
      borderWidth: 1,
      paddingVertical: 13,
      alignItems: 'center',
      marginTop: 10,
      backgroundColor: colors.surface,
    },
    secondaryText: { fontWeight: '800', fontSize: 15 },
  });
}
