import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { pickDocument, pickImage } from '../services/media';
import { useTheme } from '../theme/ThemeProvider';

export function MessageComposer({
  value,
  onChangeText,
  onSubmit,
  onPick,
  recording,
  onToggleRecording,
  enterToSend = true,
}) {
  const { colors, accent } = useTheme();
  const [busy, setBusy] = useState(false);

  async function handlePick(kind) {
    if (busy) return;
    setBusy(true);
    try {
      const result = kind === 'document' ? await pickDocument() : await pickImage({ fromCamera: false });
      if (result) onPick?.(result);
    } catch (error) {
      onChangeText(''); // no-op keeps signature stable
      throw error;
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.composer, { backgroundColor: colors.panel, borderTopColor: colors.border }]}>
      <TouchableOpacity style={styles.iconButton} onPress={() => handlePick('image')}>
        <Text style={styles.iconText}>🖼</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconButton} onPress={() => handlePick('document')}>
        <Text style={styles.iconText}>📎</Text>
      </TouchableOpacity>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={enterToSend ? onSubmit : undefined}
        placeholder="Message"
        placeholderTextColor={colors.muted}
        multiline
      />
      {value.trim() ? (
        <TouchableOpacity style={[styles.sendButton, { backgroundColor: accent }]} onPress={onSubmit}>
          <Text style={styles.sendText}>➤</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.sendButton, { backgroundColor: recording ? colors.danger : accent }]}
          onPress={onToggleRecording}
        >
          <Text style={styles.sendText}>{recording ? '■' : '🎤'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  iconButton: { paddingHorizontal: 8, paddingVertical: 10 },
  iconText: { fontSize: 20 },
  input: {
    flex: 1,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  sendButton: { width: 40, height: 40, borderRadius: 20, marginLeft: 8, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#071d22', fontSize: 16, fontWeight: '700' },
});
