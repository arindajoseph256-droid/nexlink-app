import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { Avatar, ErrorText, SettingsRow, SectionTitle } from '../components/ui';
import { useTheme } from '../theme/ThemeProvider';
import { installedVersion } from '../services/updateService';

export function SettingsScreen({ user, onLogout }) {
  const navigation = useNavigation();
  const theme = useTheme();
  const colors = theme.colors;

  function confirmLogout() {
    Alert.alert('Log out', 'You will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => onLogout?.() },
    ]);
  }

  const styles = makeStyles(colors);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.profileCard, { backgroundColor: colors.surface }]}>
          <TouchableOpacity style={styles.profileRow} onPress={() => navigation.navigate('Profile')}>
            <Avatar name={user?.display_name} uri={user?.avatar_url} size={52} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }} numberOfLines={1}>
                {user?.display_name || 'Nexlink user'}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12.5 }}>{user?.phone_number}</Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
          </TouchableOpacity>
        </View>

        <SectionTitle>Account</SectionTitle>
        <SettingsRow
          label="Profile"
          description="Name, about and avatar"
          onPress={() => navigation.navigate('Profile')}
        />
        <SettingsRow
          label="Change email"
          description={user?.email || 'No email set — add one for password resets'}
          onPress={() => navigation.navigate('ChangeEmail')}
        />
        <SettingsRow
          label="Change password"
          description="Update your account password"
          onPress={() => navigation.navigate('ChangePassword')}
        />

        <SectionTitle>Chats</SectionTitle>
        <SettingsRow
          label="Starred messages"
          description="Everything you starred, in one list"
          onPress={() => navigation.navigate('StarredMessages')}
        />
        <SettingsRow
          label="Contacts"
          description="People you have saved"
          onPress={() => navigation.navigate('Contacts')}
        />
        <SettingsRow
          label="Enter to send"
          description="Keyboard behaviour in chats"
          onPress={() => navigation.navigate('ChatSettings')}
        />

        <SectionTitle>Appearance</SectionTitle>
        <SettingsRow
          label="Theme & accent colour"
          description={`Current: ${theme?.themePref || 'dark'} · accent ${theme?.accent || ''}`}
          onPress={() => navigation.navigate('AppearanceSettings')}
        />

        <SectionTitle>Notifications</SectionTitle>
        <SettingsRow
          label="Message notifications & sounds"
          description="Alerts for new messages"
          onPress={() => navigation.navigate('NotificationSettings')}
        />

        <SectionTitle>Privacy</SectionTitle>
        <SettingsRow
          label="Read receipts, typing & last seen"
          description="Control what others see"
          onPress={() => navigation.navigate('PrivacySettings')}
        />

        <SectionTitle>Calls</SectionTitle>
        <SettingsRow
          label="Call history"
          description="Recent incoming and outgoing calls"
          onPress={() => navigation.navigate('CallHistory')}
        />

        <SectionTitle>App</SectionTitle>
        <SettingsRow
          label="Version"
          description={`Nexlink for Android · ${installedVersion}`}
        />

        <View style={{ height: 20 }} />
        <SettingsRow label="Log out" danger onPress={confirmLogout} />
        <Text style={[styles.versionNote, { color: colors.muted }]}>
          Settings sync with your Nexlink account across web and mobile.
        </Text>
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
    profileCard: { borderRadius: 14, marginHorizontal: 12, marginTop: 6, marginBottom: 4 },
    profileRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
    versionNote: { textAlign: 'center', fontSize: 12, marginTop: 20, paddingHorizontal: 30, lineHeight: 18 },
  });
}
