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
import { createNavigationContainerRef } from '@react-navigation/native';

import { onAuthExpired } from './src/api/client';
import { API_BASE_URL, configDiagnostics } from './src/api/config';
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
import { emitRealtimeEvent } from './src/services/realtimeBus';
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
  const [pendingChatTap, setPendingChatTap] = useState(null);
  const [connectivity, setConnectivity] = useState(null); // null | 'down'
  const [bootNonce, setBootNonce] = useState(0);
  const navigationRef = createNavigationContainerRef();

  const userRef = useRef(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const verifyConnectivity = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/health/`, { method: 'HEAD', cache: 'no-store' });
      setConnectivity(null);
      return true;
    } catch {
      setConnectivity('down');
      return false;
    }
  }, []);

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
        // No stored session: probe the API once so a dead network explains
        // itself instead of failing on the first login attempt.
        if (!cancelled) {
          await verifyConnectivity();
          setBooting(false);
        }
        return;
      }

      try {
        const me = await getMe();
        if (!cancelled) {
          setUser(me);
          cacheUser(me).catch(() => {});
        }
      } catch (err) {
        const message = String(err?.message || '');
        if (/connect|internet|respond|reach/i.test(message)) {
          // Network/server problem — keep the session and offer a retry.
          if (!cancelled) setConnectivity('down');
        } else {
          // token invalid/expired → clear and show login
          await setAuthToken(null);
          if (!cancelled) setUser(null);
        }
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
  }, [bootNonce]);

  async function retryConnection() {
    const ok = await verifyConnectivity();
    if (ok) setBootNonce((nonce) => nonce + 1); // re-run boot (verify token, updates, socket)
  }

  /* ---------- realtime: shared notifications socket ---------- */
  const handleUserEvent = useCallback((event) => {
    // Fan out to subscribed screens (badges, lists, notifications modal) and
    // keep a lightweight conversations prefetch for cold screens.
    emitRealtimeEvent(event);
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
      // Real navigation: resolve the conversation and push the Chat screen
      // once the container is ready (see effect below).
      setPendingChatTap(String(conversationId));
    });
    return () => {
      offTap();
    };
  }, [user]);

  /* ---------- notification tap → open the right conversation ---------- */
  useEffect(() => {
    if (!pendingChatTap || !user) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await getConversations();
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data.results || [];
        const conversation = list.find((item) => String(item.id) === pendingChatTap);
        if (conversation && navigationRef.isReady()) {
          navigationRef.navigate('Chat', { conversation });
          setPendingChatTap(null);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingChatTap, user, navigationRef]);

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

  /* Startup diagnostics: no session AND the API is unreachable → explain + Retry.
     With a cached session we still enter the app (offline-capable) and let the
     per-screen offline banners and ConnectionBanner do their job. */
  if (connectivity === 'down' && !user) {
    return (
      <SafeAreaView style={styles.boot}>
        <View style={styles.bootMark}>
          <Text style={styles.bootMarkText}>N</Text>
        </View>
        <Text style={styles.bootTitle}>NEXLINK</Text>
        <Text style={styles.connectTitle}>Unable to connect to Nexlink.</Text>
        <Text style={styles.connectBody}>
          Please check your internet connection or try again.
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={retryConnection} activeOpacity={0.8}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <ThemeProvider>
      <RootNavigator user={user} onLogout={finishLogout} navigationRef={navigationRef} />
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
  connectTitle: { color: '#f2fffb', fontSize: 16, fontWeight: '700', marginTop: 22 },
  connectBody: { color: 'rgba(242,255,251,0.65)', fontSize: 13.5, textAlign: 'center', marginTop: 6, marginHorizontal: 34, lineHeight: 20 },
  retryButton: {
    marginTop: 22,
    backgroundColor: '#00a884',
    paddingHorizontal: 34,
    paddingVertical: 12,
    borderRadius: 999,
  },
  retryText: { color: '#071d22', fontWeight: '800', fontSize: 14.5 },
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
