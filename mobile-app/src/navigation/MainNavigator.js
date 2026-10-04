import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AccountSettingsScreen } from '../screens/AccountSettingsScreen';
import { AppearanceSettingsScreen } from '../screens/AppearanceSettingsScreen';
import { CallScreen } from '../screens/CallScreen';
import { CallHistoryScreen } from '../screens/CallHistoryScreen';
import { ChangeEmailScreen } from '../screens/ChangeEmailScreen';
import { ChangePasswordScreen } from '../screens/ChangePasswordScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { ChatSettingsScreen } from '../screens/ChatSettingsScreen';
import { ContactsScreen } from '../screens/ContactsScreen';
import { ConversationsScreen } from '../screens/ConversationsScreen';
import { GroupAdminScreen } from '../screens/GroupAdminScreen';
import { GroupScreen } from '../screens/GroupScreen';
import { NotificationSettingsScreen } from '../screens/NotificationSettingsScreen';
import { PrivacySettingsScreen } from '../screens/PrivacySettingsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SharedMediaScreen } from '../screens/SharedMediaScreen';
import { StarredMessagesScreen } from '../screens/StarredMessagesScreen';
import { useTheme } from '../theme/ThemeProvider';

const Stack = createNativeStackNavigator();

export function MainNavigator({ user, onLogout, onUserUpdated }) {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Conversations">
        {(props) => <ConversationsScreen {...props} user={user} onLogout={onLogout} />}
      </Stack.Screen>
      <Stack.Screen name="Chat">
        {(props) => <ChatScreen {...props} user={user} />}
      </Stack.Screen>
      <Stack.Screen name="Profile">
        {(props) => <ProfileScreen {...props} user={user} onUserUpdated={onUserUpdated} />}
      </Stack.Screen>
      <Stack.Screen name="Settings">
        {(props) => <SettingsScreen {...props} user={user} onLogout={onLogout} />}
      </Stack.Screen>
      <Stack.Screen name="AccountSettings">
        {(props) => <AccountSettingsScreen {...props} user={user} onUserUpdated={onUserUpdated} />}
      </Stack.Screen>
      <Stack.Screen name="AppearanceSettings" component={AppearanceSettingsScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="PrivacySettings" component={PrivacySettingsScreen} />
      <Stack.Screen name="ChatSettings" component={ChatSettingsScreen} />
      <Stack.Screen name="GroupCreate">
        {(props) => <GroupScreen {...props} user={user} />}
      </Stack.Screen>
      <Stack.Screen name="GroupAdmin">
        {(props) => <GroupAdminScreen {...props} user={user} />}
      </Stack.Screen>
      <Stack.Screen name="SharedMedia" component={SharedMediaScreen} />
      <Stack.Screen name="StarredMessages" component={StarredMessagesScreen} />
      <Stack.Screen name="CallHistory" component={CallHistoryScreen} />
      <Stack.Screen name="Contacts" component={ContactsScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="ChangeEmail">
        {(props) => <ChangeEmailScreen {...props} user={user} onUserUpdated={onUserUpdated} />}
      </Stack.Screen>
      <Stack.Screen
        name="Call"
        component={CallScreen}
        options={{ presentation: 'fullScreenModal' }}
      />
    </Stack.Navigator>
  );
}
