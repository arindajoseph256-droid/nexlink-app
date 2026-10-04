import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { pickDocument, pickImage } from '../services/media';
import { useTheme } from '../theme/ThemeProvider';

export function MessageComposer({
  value,
  onChangeText,
  onSubmit,
  onPick,
  recording,
  uploading,
  onToggleRecording,
  enterToSend = true,
}) {
  const { colors, accent } = useTheme();
  const [busy, setBusy] = useState(false);
  const disabled = busy || uploading;

  async function handlePick(kind) {
    if (busy) return;
    setBusy(true);
    try {
      const result =
        kind === 'document'
          ? await pickDocument()
          : await pickImage({ fromCamera: kind === 'camera' });
      if (result) onPick?.(result);
    } catch (error) {
      Alert.alert('Nexlink', String(error?.message || error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.composer, { backgroundColor: colors.panel, borderTopColor: colors.border }]}>
      <TouchableOpacity style={styles.iconButton} onPress={() => handlePick('image')} disabled={disabled}>
        <Text style={[styles.iconText, disabled && { opacity: 0.4 }]}>🖼</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.iconButton}
        onPress={() => handlePick('camera')}
        disabled={disabled}
        accessibilityLabel="Take a photo"
      >
        <Text style={[styles.iconText, disabled && { opacity: 0.4 }]}>📷</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconButton} onPress={() => handlePick('document')} disabled={disabled}>
        <Text style={[styles.iconText, disabled && { opacity: 0.4 }]}>📎</Text>
      </TouchableOpacity>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={enterToSend ? onSubmit : undefined}
        placeholder={uploading ? 'Uploading…' : recording ? 'Recording… tap ■ to send' : 'Message'}
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
          disabled={disabled}
        >
          <Text style={styles.sendText}>{recording ? '■' : uploading ? '…' : '🎤'}</Text>
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
