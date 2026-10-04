import React, { useContext, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { changeEmail } from '../api/auth';
import { ErrorText, SectionTitle } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

/** Change the account email (web parity: settings → account email). */
export function ChangeEmailScreen({ user, onUserUpdated }) {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [email, setEmail] = useState(user?.email || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const data = await changeEmail(email.trim());
      onUserUpdated?.({ email: data.email });
      setSaved(true);
      Alert.alert('Email updated', `Your account email is now ${data.email || '(empty)'}.`, [
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Change email</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <SectionTitle>Account email</SectionTitle>
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
          Used for password resets and account recovery. Leave empty to remove the email from your account.
        </Text>

        <ErrorText message={error} />
        {saved ? <Text style={{ color: colors.success, fontWeight: '700', paddingHorizontal: 4 }}>Saved ✓</Text> : null}

        <TouchableOpacity
          onPress={submit}
          disabled={busy}
          style={[styles.submit, { backgroundColor: accent, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={styles.submitText}>{busy ? 'Saving…' : 'Save email'}</Text>
        </TouchableOpacity>
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
    note: { fontSize: 12, marginTop: 10, lineHeight: 18 },
  });
}
