import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ACCENT_CHOICES,
  DEFAULT_ACCENT,
  darkColors,
  lightColors,
  normalizeAccent,
  withAlpha,
} from './colors';

const THEME_KEY = 'nexlink.theme';
const ACCENT_KEY = 'nexlink.accent';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [pref, setPref] = useState('dark'); // matches web default
  const [accent, setAccent] = useState(DEFAULT_ACCENT.dark);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [savedTheme, savedAccent] = await Promise.all([
          AsyncStorage.getItem(THEME_KEY),
          AsyncStorage.getItem(ACCENT_KEY),
        ]);
        if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
          setPref(savedTheme);
        }
        const normalized = normalizeAccent(savedAccent);
        if (normalized) setAccent(normalized);
      } catch {}
      setHydrated(true);
    })();
  }, []);

  const resolved = pref === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : pref;
  const colors = useMemo(() => ({ ...(resolved === 'dark' ? darkColors : lightColors), accent }), [resolved, accent]);

  function setTheme(next) {
    if (!['light', 'dark', 'system'].includes(next)) return;
    setPref(next);
    AsyncStorage.setItem(THEME_KEY, next).catch(() => {});
  }

  function applyAccent(hex) {
    const normalized = normalizeAccent(hex);
    if (!normalized || !ACCENT_CHOICES.includes(normalized)) return;
    setAccent(normalized);
    AsyncStorage.setItem(ACCENT_KEY, normalized).catch(() => {});
  }

  const value = useMemo(
    () => ({
      colors,
      themePref: pref,
      resolvedTheme: resolved,
      accent,
      accentChoices: ACCENT_CHOICES,
      setTheme,
      applyAccent,
      withAlpha: (ratio) => withAlpha(accent, ratio),
    }),
    [colors, pref, resolved, accent],
  );

  if (!hydrated) return null; // avoid theme flash on boot
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
