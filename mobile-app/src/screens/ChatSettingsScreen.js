import React, { useContext, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { getPreferences, updatePreferences } from '../api/settings';
import { ErrorText, SettingsSwitch, SectionTitle } from '../components/ui';
import { loadEnterToSend, saveEnterToSend } from '../storage/settingsStorage';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

export function ChatSettingsScreen() {
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const [enterToSend, setEnterToSend] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getPreferences()
      .then((prefs) => {
        if (typeof prefs.enter_to_send === 'boolean') {
          setEnterToSend(prefs.enter_to_send);
          saveEnterToSend(prefs.enter_to_send);
        }
      })
      .catch(async () => {
        // offline: fall back to the local value
        setEnterToSend(await loadEnterToSend());
      });
  }, []);

  async function toggleEnterToSend(value) {
    setEnterToSend(value);
    await saveEnterToSend(value); // composer needs this instantly, even offline
    try {
      await updatePreferences({ enter_to_send: value });
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Chats</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <SectionTitle>Keyboard</SectionTitle>
        <SettingsSwitch
          label="Enter to send"
          description="Send a message with the keyboard's enter key"
          value={enterToSend}
          onValueChange={toggleEnterToSend}
        />
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
