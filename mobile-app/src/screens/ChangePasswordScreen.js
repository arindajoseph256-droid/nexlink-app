import React, { useContext, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { changePassword } from '../api/auth';
import { ErrorText, SectionTitle } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

/** Change password (web parity: accounts/password-change). */
export function ChangePasswordScreen() {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!oldPassword || !newPassword) {
      setError('Fill in your current and new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await changePassword(oldPassword, newPassword, confirmPassword);
      Alert.alert('Password changed', 'Your password has been updated. You stay signed in on this device.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Change password</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <SectionTitle>Password</SectionTitle>
        <Text style={[styles.label, { color: colors.muted }]}>Current password</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={oldPassword}
          onChangeText={setOldPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholder="••••••••"
          placeholderTextColor={colors.muted}
        />
        <Text style={[styles.label, { color: colors.muted }]}>New password</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholder="At least 8 characters"
          placeholderTextColor={colors.muted}
        />
        <Text style={[styles.label, { color: colors.muted }]}>Confirm new password</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholder="Repeat the new password"
          placeholderTextColor={colors.muted}
        />

        <ErrorText message={error} />

        <TouchableOpacity
          onPress={submit}
          disabled={busy}
          style={[styles.submit, { backgroundColor: accent, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={styles.submitText}>{busy ? 'Updating…' : 'Update password'}</Text>
        </TouchableOpacity>

        <Text style={[styles.note, { color: colors.muted }]}>
          Forgot it instead? Use the reset link on the sign-in screen.
        </Text>
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
    submit: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 20 },
    submitText: { color: '#071d22', fontWeight: '800', fontSize: 15 },
    note: { fontSize: 12, textAlign: 'center', marginTop: 14, lineHeight: 18 },
  });
}
