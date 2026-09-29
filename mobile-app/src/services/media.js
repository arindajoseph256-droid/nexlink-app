/**
 * Media service: image/camera/document/voice-note helpers.
 * Uses SDK-57 packages (expo-image-picker, expo-document-picker, expo-audio).
 * Each helper degrades gracefully with a clear message when a module or
 * permission is unavailable — no silent no-op buttons.
 */
let ImagePicker = null;
try {
  ImagePicker = require('expo-image-picker');
} catch {}
let DocumentPicker = null;
try {
  DocumentPicker = require('expo-document-picker');
} catch {}
let ExpoAudio = null;
try {
  ExpoAudio = require('expo-audio');
} catch {}

function requireModule(mod, feature) {
  if (!mod) throw new Error(`${feature} is unavailable in this build.`);
  return mod;
}

export async function pickImage({ fromCamera = false, allowsEditing = false, aspect = [1, 1] } = {}) {
  const picker = requireModule(ImagePicker, 'Image picking');
  const permission = fromCamera
    ? await picker.requestCameraPermissionsAsync()
    : await picker.requestMediaLibraryPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new Error('Permission denied. Enable it in Settings to send photos.');
  }
  const baseOptions = {
    quality: 0.7,
    mediaTypes: ['images'],
    ...(allowsEditing ? { allowsEditing: true, aspect } : {}),
  };
  const result = fromCamera
    ? await picker.launchCameraAsync(baseOptions)
    : await picker.launchImageLibraryAsync(baseOptions);
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const kind = asset.type === 'video' ? 'video' : 'image';
  return {
    kind,
    file: {
      uri: asset.uri,
      name: asset.fileName || `${kind}-${Date.now()}.jpg`,
      mimeType: asset.mimeType || (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
    },
  };
}

export async function pickDocument() {
  const picker = requireModule(DocumentPicker, 'Document picking');
  const result = await picker.getDocumentAsync({ copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;
  return {
    kind: 'file',
    file: {
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType || 'application/octet-stream',
    },
  };
}

/* --- Voice notes via expo-audio (SDK 57 recorder API) --- */

export async function startVoiceRecording() {
  const audio = requireModule(ExpoAudio, 'Voice recording');
  const permission = await audio.requestRecordingPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new Error('Microphone permission denied. Enable it in Settings to record voice notes.');
  }
  const file = new audio.AudioRecorder.DocumentDirectoryURI(`voice-${Date.now()}.m4a`);
  const recorder = new audio.AudioRecorder();
  recorder.record(file);
  return { recorder, file };
}

export async function stopVoiceRecording(recorder) {
  const audio = requireModule(ExpoAudio, 'Voice recording');
  const uri = await recorder.stop();
  void audio;
  return { kind: 'audio', file: { uri, name: `voice-${Date.now()}.m4a`, mimeType: 'audio/mp4' } };
}

export function audioModulesAvailable() {
  return { imagePicker: Boolean(ImagePicker), documentPicker: Boolean(DocumentPicker), audio: Boolean(ExpoAudio) };
}

export { ExpoAudio };
