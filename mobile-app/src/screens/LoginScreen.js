import React, { useContext, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { login } from '../api/auth';
import { API_BASE_URL, APP_VERSION_LABEL } from '../api';
import { ErrorText, LoadingState } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

export function LoginScreen({ navigation, onAuthenticated }) {
  const theme = useContext(ThemeContext);
  const colors = theme?.colors;
  const accent = theme?.accent || '#74ffd6';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const data = await login(identifier, password);
      onAuthenticated(data.user);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const styles = makeStyles(colors || {}, accent);

  return (
    <KeyboardAvoidingView
      style={[styles.page, { backgroundColor: colors.welcomeBg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.topline}>
            <View style={styles.mark}>
              <Text style={styles.markText}>N</Text>
            </View>
            <Text style={styles.brand}>NEXLINK</Text>
          </View>
          <Text style={styles.eyebrow}>PRIVATE MESSAGING</Text>
          <Text style={styles.title}>Say hello to everyone.</Text>
          <Text style={styles.lead}>
            One account for every screen — phone, tablet and desktop. Messages stay in sync, instantly.
          </Text>
          <View style={styles.signal}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text style={styles.signalText}>REAL-TIME · SECURE · FREE</Text>
            <View style={[styles.line, { backgroundColor: accent }]} />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.panel }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Log in</Text>
          <Text style={[styles.cardSubtitle, { color: colors.muted }]}>Use your phone number or email.</Text>
          <ErrorText message={error} />
          <Text style={[styles.label, { color: colors.muted }]}>Phone or email</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="+256700000000 or you@example.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text style={[styles.label, { color: colors.muted }]}>Password</Text>
          <View style={[styles.passwordRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <TextInput
              style={[styles.input, { flex: 1, borderWidth: 0, backgroundColor: 'transparent', color: colors.text }]}
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={colors.muted}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword((s) => !s)} style={styles.showButton}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={submit} disabled={busy} style={[styles.button, { backgroundColor: accent }]}>
            {busy ? <LoadingState /> : <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Log in'}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Register')} style={styles.linkRow}>
            <Text style={{ color: colors.muted }}>New to Nexlink? </Text>
            <Text style={{ color: accent, fontWeight: '700' }}>Create an account</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Linking.openURL(`${API_BASE_URL}/accounts/password-reset/`)}
            style={styles.linkRow}
          >
            <Text style={{ color: colors.muted, fontSize: 13 }}>Forgot password?</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.versionText}>{APP_VERSION_LABEL}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors, accent) {
  return StyleSheet.create({
    page: { flex: 1 },
    inner: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 24 },
    hero: { alignItems: 'flex-start', gap: 8 },
    topline: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
    mark: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      borderColor: 'rgba(201,255,238,0.4)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    markText: { color: accent, fontSize: 20, fontWeight: '800' },
    brand: { color: colors.welcomeText, fontSize: 18, fontWeight: '800', letterSpacing: 3 },
    eyebrow: { color: accent, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
    title: { color: colors.welcomeText, fontSize: 30, fontWeight: '800', lineHeight: 36 },
    lead: { color: 'rgba(242,255,251,0.72)', fontSize: 14.5, lineHeight: 21 },
    signal: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    signalText: { color: accent, fontSize: 10.5, letterSpacing: 1.5, fontWeight: '700' },
    line: { height: 1, flex: 1, opacity: 0.35 },
    card: { borderRadius: 22, padding: 22 },
    cardTitle: { fontSize: 22, fontWeight: '800' },
    cardSubtitle: { fontSize: 13.5, marginTop: 2, marginBottom: 14 },
    label: { fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
    passwordRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12 },
    showButton: { paddingHorizontal: 14 },
    button: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
    buttonText: { color: '#071d22', fontWeight: '800', fontSize: 15 },
    linkRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 14 },
    versionText: { color: 'rgba(242,255,251,0.45)', fontSize: 11, textAlign: 'center', letterSpacing: 0.5 },
  });
}
