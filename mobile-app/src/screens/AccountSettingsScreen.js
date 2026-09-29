import React, { useContext, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { getMe, updateProfile } from '../api/auth';
import { uploadAvatar } from '../api/auth';
import { pickImage } from '../services/media';
import { Avatar, ErrorText, SectionTitle } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

/** Account settings: edit profile details and avatar (real API-backed). */
export function AccountSettingsScreen({ user, onUserUpdated }) {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [about, setAbout] = useState(user?.about || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || null);
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

  async function changeAvatar() {
    setError('');
    try {
      // allowsEditing opens the native crop UI (square 1:1) before upload.
      const result = await pickImage({ fromCamera: false, allowsEditing: true, aspect: [1, 1] });
      if (!result) return;
      setBusy(true);
      const data = await uploadAvatar(result.file);
      if (data.avatar_url) {
        // Same URL now serves different bytes — bust the RN image cache.
        const fresh = `${data.avatar_url}${data.avatar_url.includes('?') ? '&' : '?'}v=${Date.now()}`;
        setAvatarUrl(fresh);
        onUserUpdated?.({ avatar_url: fresh });
        setSaved(true);
      } else {
        setError(data.detail || 'Upload failed');
      }
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Account</Text>
      </View>

      <View style={styles.body}>
        <SectionTitle>Profile</SectionTitle>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <TouchableOpacity style={styles.avatarRow} onPress={changeAvatar}>
            <Avatar name={displayName} uri={avatarUrl} size={64} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>Profile photo</Text>
              <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>
                Tap to choose a new picture
              </Text>
            </View>
          </TouchableOpacity>

          <Text style={[styles.label, { color: colors.muted }]}>Display name</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
            value={displayName}
            onChangeText={setDisplayName}
          />
          <Text style={[styles.label, { color: colors.muted }]}>About</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg, minHeight: 70 }]}
            value={about}
            onChangeText={setAbout}
            multiline
          />
          <Text style={[styles.label, { color: colors.muted }]}>Phone</Text>
          <Text style={{ color: colors.text, fontSize: 15 }}>{user?.phone_number || '—'}</Text>
        </View>

        <ErrorText message={error} />
        {saved ? <Text style={{ color: colors.success, fontWeight: '700', paddingHorizontal: 16 }}>Saved ✓</Text> : null}

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
    headerTitle: { fontSize: 20, fontWeight: '800' },
    body: { padding: 12 },
    card: { borderRadius: 14, padding: 16, marginTop: 4 },
    avatarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    label: { fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
    saveButton: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
    saveText: { color: '#071d22', fontWeight: '800', fontSize: 15 },
  });
}
