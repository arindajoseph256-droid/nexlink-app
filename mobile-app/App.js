/**
 * Nexlink for Android — app entry point.
 *
 * Boot flow:
 *   restore auth (secure store) → theme hydration
 *   → verify token against /api/auth/me/full/
 *   → check OTA update (EAS Update) + binary version (server endpoint)
 *   → connect WebSocket (notifications room, backoff reconnect)
 *   → register push token → render
 *
 * On foreground resume: reconnect sockets + refresh (syncService).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { onAuthExpired } from './src/api/client';
import { configDiagnostics } from './src/api/config';
import { getMe } from './src/api/auth';
import { getConversations } from './src/api/conversations';
import { registerPushToken, unregisterPushToken } from './src/api/notifications';
import { cacheUser, loadAuthToken, loadCachedUser, setAuthToken } from './src/storage/authStorage';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import {
  addNotificationTapListener,
  notificationsAvailable,
  registerForPush,
  setNotificationHandler,
} from './src/services/notifications';
import { onForegroundSync, startSyncService } from './src/services/syncService';
import {
  applyOtaUpdate,
  checkBinaryUpdate,
  checkOtaUpdate,
  installedVersion,
  postponeBinaryUpdate,
} from './src/services/updateService';
import { ensureUserSocket, resetUserSocket } from './src/services/websocket';

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [pushToken, setPushToken] = useState(null);
  const [updateNotice, setUpdateNotice] = useState(null);

  const userRef = useRef(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  /* ---------- boot: restore session, verify token, check updates ---------- */
  useEffect(() => {
    let cancelled = false;

    if (configDiagnostics.guardTriggered) {
      console.warn('[nexlink] config:', JSON.stringify(configDiagnostics));
    }

    (async () => {
      const token = await loadAuthToken();
      const cached = await loadCachedUser();
      if (!cancelled && cached) setUser(cached); // instant paint with cached identity

      if (!token) {
        if (!cancelled) setBooting(false);
        return;
      }

      try {
        const me = await getMe();
        if (!cancelled) {
          setUser(me);
          cacheUser(me).catch(() => {});
        }
      } catch {
        // token invalid/expired → clear and show login
        await setAuthToken(null);
        if (!cancelled) setUser(null);
      }

      if (cancelled) return;

      /* updates: OTA first (JS/assets), then binary version check */
      const ota = await checkOtaUpdate();
      if (ota?.isAvailable) {
        setUpdateNotice({ kind: 'ota-ready' });
      }
      const binary = await checkBinaryUpdate();
      if (binary && (binary.update_available || binary.update_required) && !binary.dismissed) {
        setUpdateNotice({ kind: 'binary', ...binary });
      }

      if (!cancelled) setBooting(false);
    })();

    const stopSync = startSyncService();
    return () => {
      cancelled = true;
      stopSync();
    };
  }, []);

  /* ---------- realtime: shared notifications socket ---------- */
  const handleUserEvent = useCallback(() => {
    // Lightweight refresh keeps unread badges and the list fresh on every
    // screen; the Conversations screen also subscribes to foreground sync.
    getConversations().catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    ensureUserSocket(handleUserEvent);
    return () => {};
  }, [user, handleUserEvent]);

  /* ---------- foreground sync: reconnect + refresh ---------- */
  useEffect(() => {
    if (!user) return undefined;
    const off = onForegroundSync(() => {
      ensureUserSocket(handleUserEvent).reconnectNow();
    });
    return off;
  }, [user, handleUserEvent]);

  /* ---------- push notifications ---------- */
  useEffect(() => {
    if (!user || !notificationsAvailable()) return undefined;
    setNotificationHandler();
    let token = null;
    (async () => {
      token = await registerForPush(registerPushToken);
      if (token) setPushToken(token);
    })();
    const offTap = addNotificationTapListener((conversationId) => {
      // Handled inside ConversationsScreen via route params when opened;
      // deep-link handling stays a no-op until the chat route is mounted.
      void conversationId;
    });
    return () => {
      offTap();
    };
  }, [user]);

  /* ---------- auth expiry (401 from any request) ---------- */
  const finishLogout = useCallback(
    async (callServer = true) => {
      if (pushToken) unregisterPushToken(pushToken).catch(() => {});
      if (callServer) {
        const { logout } = require('./src/api/auth');
        await logout();
      }
      await setAuthToken(null);
      resetUserSocket();
      setUser(null);
      setPushToken(null);
    },
    [pushToken],
  );

  useEffect(() => {
    if (!user) return undefined;
    return onAuthExpired(() => {
      finishLogout(false);
    });
  }, [user, finishLogout]);

  if (booting) {
    return (
      <SafeAreaView style={styles.boot}>
        <View style={styles.bootMark}>
          <Text style={styles.bootMarkText}>N</Text>
        </View>
        <Text style={styles.bootTitle}>NEXLINK</Text>
        <ActivityIndicator color="#74ffd6" style={{ marginTop: 16 }} />
      </SafeAreaView>
    );
  }

  return (
    <ThemeProvider>
      <RootNavigator user={user} onLogout={finishLogout} />
      {updateNotice ? (
        <UpdateNotice notice={updateNotice} onDismiss={() => setUpdateNotice(null)} />
      ) : null}
    </ThemeProvider>
  );
}

function UpdateNotice({ notice, onDismiss }) {
  const { colors, accent } = useTheme();

  async function restartForOta() {
    onDismiss();
    await applyOtaUpdate();
  }

  function openDownload() {
    if (notice.download_url) Linking.openURL(notice.download_url);
  }

  function postpone() {
    if (notice.kind === 'binary') postponeBinaryUpdate(notice.latest_version).catch(() => {});
    onDismiss();
  }

  return (
    <View style={[styles.notice, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      {notice.kind === 'ota-ready' ? (
        <>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13.5 }}>Update ready</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            A Nexlink update was downloaded. Restart to apply.
          </Text>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
            <TouchableOpacity onPress={postpone}>
              <Text style={{ color: colors.muted, fontWeight: '600' }}>Later</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={restartForOta}>
              <Text style={{ color: accent, fontWeight: '800' }}>Restart now</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
            {notice.update_required
              ? 'Nexlink must be updated'
              : `Nexlink update available — ${notice.latest_version}`}
          </Text>
          {notice.release_notes ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>{notice.release_notes}</Text>
          ) : null}
          <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 3 }}>
            Installed: {installedVersion}
            {notice.update_required ? ' · this version is no longer supported' : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
            {notice.download_url ? (
              <TouchableOpacity onPress={openDownload}>
                <Text style={{ color: accent, fontWeight: '800' }}>Update now</Text>
              </TouchableOpacity>
            ) : null}
            {!notice.update_required ? (
              <TouchableOpacity onPress={postpone}>
                <Text style={{ color: colors.muted, fontWeight: '600' }}>Later</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: '#071d22', alignItems: 'center', justifyContent: 'center' },
  bootMark: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(201,255,238,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bootMarkText: { color: '#74ffd6', fontSize: 34, fontWeight: '800' },
  bootTitle: { color: '#f2fffb', fontSize: 18, fontWeight: '800', letterSpacing: 4, marginTop: 14 },
  notice: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 18,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
});
