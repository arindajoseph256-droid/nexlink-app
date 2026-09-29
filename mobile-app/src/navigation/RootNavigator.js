import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';

import { useTheme } from '../theme/ThemeProvider';
import { AuthNavigator } from './AuthNavigator';
import { MainNavigator } from './MainNavigator';

export function RootNavigator({ user, onLogout }) {
  const { colors } = useTheme();
  return (
    <NavigationContainer>
      <StatusBar style={colors.statusBar} backgroundColor={colors.welcomeBg} />
      {user ? <MainNavigator user={user} onLogout={onLogout} /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
