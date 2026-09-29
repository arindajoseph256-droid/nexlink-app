import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';

export function SearchBar({ value, onChangeText, placeholder = 'Search name, phone, email...' }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TextInput
        style={[styles.input, { color: colors.text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 14,
    marginVertical: 8,
    paddingHorizontal: 12,
  },
  input: { height: 38, fontSize: 14.5 },
});
