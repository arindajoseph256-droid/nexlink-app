import React from 'react';
import { ActivityIndicator, Platform, Switch, Text, TextStyle, View, ViewStyle } from 'react-native';
import { StyleSheet, TouchableOpacity } from 'react-native';

import { AuthenticatedImage } from './AuthenticatedImage';
import { useTheme } from '../theme/ThemeProvider';
import { initials } from '../utils/formatting';

export function Avatar({ name = '', uri, size = 40, online = null, color = null }) {
  const { colors, accent } = useTheme();
  const bg = color || accent;

  return (
    <View style={{ width: size, height: size }}>
      {uri ? (
        <AuthenticatedImage
          uri={uri}
          style={[styles.avatarImage, { width: size, height: size, borderRadius: size / 2 }]}
        />
      ) : (
        <View
          style={[
            styles.avatarFallback,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
          ]}
        >
          <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
        </View>
      )}
      {online != null && (
        <View
          style={[
            styles.onlineDot,
            {
              width: size * 0.26,
              height: size * 0.26,
              borderRadius: size * 0.13,
              right: -2,
              bottom: -2,
              backgroundColor: online ? colors.success : colors.muted,
              borderColor: colors.surface,
            },
          ]}
        />
      )}
    </View>
  );
}

export function ErrorText({ message }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View style={[styles.errorBox, { backgroundColor: colors.dangerSoft }]}>
      <Text style={[styles.errorText, { color: colors.danger }]}>{message}</Text>
    </View>
  );
}

export function LoadingState({ label }) {
  const { colors } = useTheme();
  return (
    <View style={styles.loadingWrap}>
      <ActivityIndicator color={colors.primary} />
      {label ? <Text style={[styles.loadingLabel, { color: colors.muted }]}>{label}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children }) {
  const { colors } = useTheme();
  return <Text style={[styles.sectionTitle, { color: colors.muted }]}>{children}</Text>;
}

export function SettingsRow({ label, description, onPress, danger = false, right = null }) {
  const { colors } = useTheme();
  const body = (
    <>
      <View style={styles.rowTextWrap}>
        <Text style={[styles.rowLabel, { color: danger ? colors.danger : colors.text }]}>{label}</Text>
        {description ? (
          <Text style={[styles.rowDescription, { color: colors.muted }]}>{description}</Text>
        ) : null}
      </View>
      {right}
      {onPress && right == null ? <Text style={[styles.chevron, { color: colors.muted }]}>›</Text> : null}
    </>
  );
  if (!onPress) {
    return <View style={[styles.settingsRow, { backgroundColor: colors.surface }]}>{body}</View>;
  }
  return (
    <TouchableOpacity
      style={[styles.settingsRow, { backgroundColor: colors.surface }]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      {body}
    </TouchableOpacity>
  );
}

export function SettingsSwitch({ label, description, value, onValueChange, disabled = false }) {
  const { colors, accent } = useTheme();
  return (
    <View style={[styles.settingsRow, { backgroundColor: colors.surface, opacity: disabled ? 0.5 : 1 }]}>
      <View style={styles.rowTextWrap}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        {description ? <Text style={[styles.rowDescription, { color: colors.muted }]}>{description}</Text> : null}
      </View>
      <Switch
        value={Boolean(value)}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: accent }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  avatarImage: { resizeMode: 'cover' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#071d22', fontWeight: '700' },
  onlineDot: { position: 'absolute', borderWidth: 2 },
  errorBox: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginHorizontal: 16, marginVertical: 6 },
  errorText: { fontSize: 13 },
  loadingWrap: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingLabel: { marginTop: 8, fontSize: 13 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 6,
    marginHorizontal: 16,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 12,
    borderRadius: 14,
    marginBottom: 8,
  },
  rowTextWrap: { flex: 1, paddingRight: 10 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowDescription: { fontSize: 12.5, marginTop: 2 },
  chevron: { fontSize: 22, fontWeight: '600' },
});
