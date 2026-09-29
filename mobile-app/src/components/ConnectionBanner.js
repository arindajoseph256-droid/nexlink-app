import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';

export function ConnectionBanner({ visible }) {
  const { colors } = useTheme();
  if (!visible) return null;
  return (
    <View style={[styles.banner, { backgroundColor: colors.warning }]}>
      <Text style={[styles.text, { color: '#071d22' }]}>
        You're offline — messages will send when you're back online.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingVertical: 6, paddingHorizontal: 14 },
  text: { fontSize: 12.5, fontWeight: '600' },
});
