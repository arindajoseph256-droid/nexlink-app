import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { AuthenticatedImage } from './AuthenticatedImage';

const SCREEN = Dimensions.get('window');
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_MS = 280;
const SNAP_BACK_BELOW = 1.12; // pinch released close to 1 → spring back
const OVERSCROLL = 0.5; // allowed pan beyond fitted size before rubber-banding

/**
 * Full-screen image viewer: pinch-to-zoom, pan while zoomed, double-tap to
 * toggle 1x/2.5x, swipe-down to dismiss.
 *
 * Built on core React Native only (Modal + Animated + PanResponder) instead
 * of react-native-gesture-handler/reanimated or react-native-image-viewing:
 * those add native modules, which would require a new APK. This component
 * ships to existing installs through EAS OTA updates.
 */
export function ImageViewerModal({ visible, uri, name, onClose, onDownload }) {
  const scale = useRef(new Animated.Value(1)).current;
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const lastRef = useRef({ scale: 1, x: 0, y: 0 });
  const pinch = useRef({ active: false, startDist: 0, startScale: 1 });
  const panOffset = useRef({ x: 0, y: 0 });
  const lastTap = useRef(0);
  const viewerSize = useRef(null); // fitted image size inside the screen

  useEffect(() => {
    if (visible) {
      StatusBar.setBarStyle('light-content');
      reset();
    }
  }, [visible]);

  function reset() {
    lastRef.current = { scale: 1, x: 0, y: 0 };
    panOffset.current = { x: 0, y: 0 };
    scale.setValue(1);
    translate.setValue({ x: 0, y: 0 });
  }

  function clampScale(value) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
  }

  function setTransform(nextScale, nextX, nextY, animate = false) {
    const bounded = clampScale(nextScale);
    const limits = panLimits(bounded);
    const x = Math.min(limits.x, Math.max(-limits.x, nextX));
    const y = Math.min(limits.y, Math.max(-limits.y, nextY));
    lastRef.current = { scale: bounded, x, y };
    if (animate) {
      Animated.parallel([
        Animated.spring(scale, { toValue: bounded, useNativeDriver: true, friction: 8 }),
        Animated.spring(translate, { toValue: { x, y }, useNativeDriver: true, friction: 8 }),
      ]).start();
    } else {
      scale.setValue(bounded);
      translate.setValue({ x, y });
    }
  }

  /** How far the image may pan at a given zoom (0 when fitted). */
  function panLimits(zoom) {
    const size = viewerSize.current;
    if (!size || zoom <= 1) return { x: 0, y: 0 };
    return {
      x: Math.max(0, (size.width * zoom - SCREEN.width) / 2 + (size.width * (zoom - 1) * OVERSCROLL) / 2),
      y: Math.max(0, (size.height * zoom - SCREEN.height) / 2),
    };
  }

  function distance(touches) {
    const [a, b] = touches;
    return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.numberActiveTouches > 1 || Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,

      onPanResponderGrant(event, gesture) {
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2) {
          pinch.current = { active: true, startDist: distance(touches), startScale: lastRef.current.scale };
          panOffset.current = { x: lastRef.current.x, y: lastRef.current.y };
        } else {
          pinch.current.active = false;
          panOffset.current = { x: lastRef.current.x, y: lastRef.current.y };
          // double-tap toggles zoom
          const now = Date.now();
          if (now - lastTap.current < DOUBLE_TAP_MS) {
            if (lastRef.current.scale > 1.05) setTransform(1, 0, 0, true);
            else setTransform(2.5, 0, 0, true);
            lastTap.current = 0;
          } else {
            lastTap.current = now;
          }
        }
      },

      onPanResponderMove(event, gesture) {
        const touches = event.nativeEvent.touches;
        if (pinch.current.active && touches.length >= 2) {
          const nextScale = clampScale(pinch.current.startScale * (distance(touches) / pinch.current.startDist));
          const limits = panLimits(nextScale);
          // keep the pan proportional while pinching
          const ratio = nextScale / (lastRef.current.scale || 1);
          setTransform(
            nextScale,
            panOffset.current.x * ratio,
            panOffset.current.y * ratio,
          );
          void limits;
        } else if (touches.length === 1) {
          const limits = panLimits(lastRef.current.scale);
          const nextX = panOffset.current.x + gesture.dx;
          const nextY = panOffset.current.y + gesture.dy;
          const boundedX = limits.x ? Math.min(limits.x, Math.max(-limits.x, nextX)) : nextX * 0.25;
          const boundedY = limits.y ? Math.min(limits.y, Math.max(-limits.y, nextY)) : nextY;
          translate.setValue({ x: boundedX, y: boundedY });
        }
      },

      onPanResponderRelease(event, gesture) {
        const touches = event.nativeEvent.touches;
        if (pinch.current.active) {
          pinch.current.active = false;
          if (lastRef.current.scale < SNAP_BACK_BELOW) {
            setTransform(1, 0, 0, true); // tiny pinch → snap back to fitted
          } else {
            setTransform(lastRef.current.scale, lastRef.current.x, lastRef.current.y, true);
          }
          return;
        }
        if (lastRef.current.scale <= 1.01 && gesture.dy > 110 && Math.abs(gesture.vx) < 1.4) {
          onClose?.(); // swipe down at 1x dismisses
          return;
        }
        if (touches.length === 0) {
          setTransform(lastRef.current.scale, lastRef.current.x, lastRef.current.y, true);
        }
      },
    }),
  ).current;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityLabel="Close image viewer">
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
        {onDownload ? (
          <TouchableOpacity
            style={styles.downloadButton}
            onPress={onDownload}
            accessibilityLabel="Download image"
          >
            <Text style={styles.closeText}>⬇</Text>
          </TouchableOpacity>
        ) : null}
        {name ? (
          <View style={styles.caption} pointerEvents="none">
            <Text style={styles.captionText} numberOfLines={1}>
              {name}
            </Text>
          </View>
        ) : null}
        <View style={styles.stage} {...responder.panHandlers}>
          <Animated.View
            style={{ transform: [{ translateX: translate.x }, { translateY: translate.y }, { scale }] }}
          >
            <AuthenticatedImage
              uri={uri}
              style={styles.image}
              resizeMode="contain"
              onSize={(size) => {
                viewerSize.current = size;
              }}
            />
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: SCREEN.width, height: SCREEN.height },
  closeButton: {
    position: 'absolute',
    top: 44,
    right: 18,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  downloadButton: {
    position: 'absolute',
    top: 44,
    right: 70,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  closeText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  caption: {
    position: 'absolute',
    bottom: 36,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  captionText: { color: '#fff', fontSize: 13 },
});
