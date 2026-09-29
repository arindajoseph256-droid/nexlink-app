import React, { useContext, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';

import { answerCall, declineCall, endCall, startCall } from '../api/calls';
import { Avatar, ErrorText } from '../components/ui';
import { ThemeContext } from '../theme/ThemeProvider';
import { friendlyError } from '../utils/errors';

/**
 * Call screen. The backend provides full call lifecycle + WebRTC signaling
 * (call_start/answer/decline/end/signal + call.* socket events), so the UI
 * and lifecycle handling are real. Peer-to-peer audio/video transport needs
 * a native WebRTC module (e.g. react-native-webrtc) which is not installed
 * in this build — media does not flow until that native module is added via
 * EAS and the integration is tested on two devices. The buttons below call
 * the real endpoints so ringing/answer/decline/end state stays in sync with
 * the web app.
 */
export function CallScreen({ user }) {
  const route = useRoute();
  const navigation = useNavigation();
  const theme = useContext(ThemeContext);
  const colors = theme?.colors || {};
  const accent = theme?.accent || '#74ffd6';
  const params = route.params || {};
  const peer = params.peer || null;
  const conversationId = params.conversationId || null;
  const callId = params.callId || null;
  const direction = params.direction || 'outgoing';
  const kind = params.kind || 'voice';

  const [status, setStatus] = useState(params.status || (direction === 'outgoing' ? 'ringing' : 'incoming'));
  const [error, setError] = useState('');
  const endedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        if (direction === 'outgoing' && conversationId && !callId) {
          const call = await startCall(conversationId, kind);
          setStatus(call.status);
          // TODO(webRTC-native): exchange SDP over call.signal once a native
          // WebRTC module is added; UI lifecycle already works.
        } else if (direction === 'incoming' && callId && status === 'incoming') {
          setStatus('ringing');
        }
      } catch (err) {
        setError(friendlyError(err));
      }
    })();
  }, [callId, conversationId, direction, kind, status]);

  async function accept() {
    try {
      const call = await answerCall(callId);
      setStatus(call.status);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function hangUp(reason) {
    if (endedRef.current) return;
    endedRef.current = true;
    try {
      if (reason === 'declined' && callId) await declineCall(callId);
      else if (callId) await endCall(callId);
    } catch {}
    navigation.goBack();
  }

  const styles = makeStyles(colors, accent);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.center}>
        <Avatar name={peer?.display_name || 'Nexlink call'} uri={peer?.avatar_url} size={110} />
        <Text style={styles.peerName}>{peer?.display_name || 'Nexlink call'}</Text>
        <Text style={styles.status}>
          {status === 'ringing' ? (direction === 'outgoing' ? 'Calling…' : 'Incoming call') : `Call ${status}`} · {kind}
        </Text>
        <ErrorText message={error} />
        <View style={styles.note}>
          <Text style={styles.noteText}>
            Nexlink signaling is live. Peer-to-peer audio/video requires the native WebRTC module — enable it in an
            upcoming EAS build.
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        {direction === 'incoming' && status === 'ringing' ? (
          <TouchableOpacity style={[styles.circleButton, { backgroundColor: colors.success }]} onPress={accept}>
            <Text style={styles.controlIcon}>✆</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.circleButton, { backgroundColor: colors.danger }]}
          onPress={() => hangUp(direction === 'incoming' && status === 'ringing' ? 'declined' : 'ended')}
        >
          <Text style={styles.controlIcon}>✕</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors, accent) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.welcomeBg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 30 },
    peerName: { color: colors.welcomeText, fontSize: 24, fontWeight: '800' },
    status: { color: accent, fontSize: 14, fontWeight: '600' },
    note: { marginTop: 12 },
    noteText: { color: 'rgba(242,255,251,0.6)', fontSize: 12, textAlign: 'center', lineHeight: 18 },
    controls: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 28,
      paddingBottom: 44,
    },
    circleButton: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center' },
    controlIcon: { color: '#ffffff', fontSize: 24, fontWeight: '800' },
  });
}
