import React, { useContext, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { register } from '../api/auth';
import { ErrorText } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';
import { isValidEmail, isValidPhone, passwordIssues } from '../utils/validation';

export function RegisterScreen({ navigation, onAuthenticated }) {
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [about, setAbout] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const issues = passwordIssues(password);

  async function submit() {
    setError('');
    if (!isValidPhone(phone)) {
      setError('Enter a valid phone number (7–15 digits).');
      return;
    }
    if (email && !isValidEmail(email)) {
      setError('That email address does not look right.');
      return;
    }
    setBusy(true);
    try {
      const data = await register({
        full_name: fullName.trim(),
        email: email.trim(),
        phone_number: phone.trim(),
        password,
        confirm_password: password,
        about: about.trim(),
      });
      onAuthenticated(data.user);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const styles = makeStyles(colors, accent);

  return (
    <KeyboardAvoidingView
      style={[styles.page, { backgroundColor: colors.welcomeBg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: colors.panel }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Join Nexlink</Text>
          <Text style={[styles.cardSubtitle, { color: colors.muted }]}>A few details and you are in.</Text>
          <ErrorText message={error} />
          <Text style={[styles.label, { color: colors.muted }]}>Full name</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Jane Doe"
            placeholderTextColor={colors.muted}
          />
          <Text style={[styles.label, { color: colors.muted }]}>Phone number</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            value={phone}
            onChangeText={setPhone}
            placeholder="+256700000000"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
          />
          <Text style={[styles.label, { color: colors.muted }]}>Email (optional)</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text style={[styles.label, { color: colors.muted }]}>Password</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            value={password}
            onChangeText={setPassword}
            placeholder="Create a password"
            placeholderTextColor={colors.muted}
            secureTextEntry
          />
          {password.length > 0 && issues.length > 0 && (
            <Text style={{ color: colors.warning, fontSize: 12, marginTop: 6 }}>
              Add {issues.join(', ')}.
            </Text>
          )}
          <Text style={[styles.label, { color: colors.muted }]}>About (optional)</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            value={about}
            onChangeText={setAbout}
            placeholder="Available on Nexlink"
            placeholderTextColor={colors.muted}
          />
          <TouchableOpacity onPress={submit} disabled={busy} style={[styles.button, { backgroundColor: accent }]}>
            <Text style={styles.buttonText}>{busy ? 'Creating account…' : 'Create account'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.linkRow}>
            <Text style={{ color: colors.muted }}>Already have an account? </Text>
            <Text style={{ color: accent, fontWeight: '700' }}>Log in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors, accent) {
  return StyleSheet.create({
    page: { flex: 1 },
    inner: { flexGrow: 1, justifyContent: 'center', padding: 24 },
    card: { borderRadius: 22, padding: 22 },
    cardTitle: { fontSize: 22, fontWeight: '800' },
    cardSubtitle: { fontSize: 13.5, marginTop: 2, marginBottom: 14 },
    label: { fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
    button: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
    buttonText: { color: '#071d22', fontWeight: '800', fontSize: 15 },
    linkRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 14 },
  });
}
