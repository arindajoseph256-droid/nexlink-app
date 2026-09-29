import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';

export function TypingIndicator({ visible, name }) {
  const { colors, accent } = useTheme();
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      setDots((current) => (current.length >= 3 ? '' : `${current}.`));
    }, 350);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;
  return (
    <Text style={{ color: accent, fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 }}>
      {name ? `${name} is typing` : 'typing'}
      {dots}
    </Text>
  );
}
